import { buildContext, collectTextNodes, isCandidateText } from '@/src/lib/candidates';
import { detectSecrets } from '@/src/lib/detectors';
import type { ClassifyResponse, ExtensionMessage, Settings } from '@/src/lib/types';
import { getSettings } from '@/src/lib/settings';

const BLUR_CLASS = 'mrsecret-blur';
const STYLE_ID = 'mrsecret-style';
const TITLE = 'Hidden by Mr. Secret';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    let settings: Settings | null = null;
    let observer: MutationObserver | null = null;
    let isMutating = false;
    const processed = new WeakSet<Text>();
    let nextId = 0;

    function injectStyle() {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent =
        `.${BLUR_CLASS}{filter:blur(6px);-webkit-filter:blur(6px);border-radius:3px;transition:filter 120ms ease;user-select:none}` +
        `.mrsecret-hover .${BLUR_CLASS}:hover{filter:none;-webkit-filter:none}`;
      (document.head ?? document.documentElement).appendChild(style);
    }

    function send(msg: ExtensionMessage): Promise<unknown> {
      return chrome.runtime.sendMessage(msg).catch(() => undefined);
    }

    let statsTimer: number | undefined;
    function reportStats() {
      clearTimeout(statsTimer);
      statsTimer = window.setTimeout(() => {
        void send({
          type: 'STATS',
          blurred: document.querySelectorAll(`.${BLUR_CLASS}`).length,
          host: location.host,
        });
      }, 300);
    }

    function insideOurs(node: Node): boolean {
      for (let el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement; el; el = el.parentElement) {
        if (el.hasAttribute?.('data-mrsecret') || el.id === STYLE_ID) return true;
      }
      return false;
    }

    function wrapRange(node: Text, start: number, end: number, kind: string) {
      const mid = node.splitText(start);
      mid.splitText(end - start);
      const span = document.createElement('span');
      span.className = BLUR_CLASS;
      span.dataset.mrsecret = kind;
      span.title = TITLE;
      mid.parentNode?.replaceChild(span, mid);
      span.appendChild(mid);
      processed.add(mid);
      const tail = span.nextSibling;
      if (tail && tail.nodeType === Node.TEXT_NODE) processed.add(tail as Text);
    }

    function wrapWhole(node: Text, kind: string) {
      const span = document.createElement('span');
      span.className = BLUR_CLASS;
      span.dataset.mrsecret = kind;
      span.title = TITLE;
      node.parentNode?.replaceChild(span, node);
      span.appendChild(node);
      processed.add(node);
    }

    function scanInputs(root: Node) {
      const els =
        root.nodeType === Node.ELEMENT_NODE
          ? [(root as Element), ...(root as Element).querySelectorAll('input,textarea')]
          : [];
      for (const el of els) {
        if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) continue;
        if (el instanceof HTMLInputElement && el.type === 'password') continue;
        const spans = detectSecrets(el.value ?? '');
        const sensitive = spans.some((s) => s.kind === 'api_key' || s.kind === 'jwt');
        if (sensitive) el.classList.add(BLUR_CLASS);
      }
    }

    async function scanRoot(root: Node) {
      if (!settings?.enabled) return;
      injectStyle();
      document.documentElement.classList.toggle('mrsecret-hover', settings.hoverReveal);

      const nodes = collectTextNodes(root).filter((t) => !processed.has(t));
      const candidates: { node: Text; text: string; id: string; context: string }[] = [];

      isMutating = true;
      try {
        for (const node of nodes) {
          processed.add(node);
          const text = node.data;
          const spans = detectSecrets(text);
          if (spans.length) {
            if (!node.isConnected) continue;
            // wrap spans right-to-left so offsets stay valid
            for (let i = spans.length - 1; i >= 0; i--) {
              const s = spans[i]!;
              try {
                wrapRange(node, s.start, s.end, s.kind);
              } catch {
                // node changed concurrently
              }
            }
          } else if (isCandidateText(text)) {
            candidates.push({
              node,
              text,
              id: `c${nextId++}`,
              context: buildContext(node),
            });
          }
        }
      } finally {
        isMutating = false;
      }

      if (candidates.length && settings.useAi && settings.apiKey) {
        const res = (await send({
          type: 'CLASSIFY',
          pageTitle: document.title,
          pageUrl: location.href,
          candidates: candidates.map(({ id, text, context }) => ({ id, text, context })),
        })) as ClassifyResponse | undefined;
        if (res?.ok) {
          isMutating = true;
          try {
            for (const c of candidates) {
              const p = res.results[c.id];
              if (p !== undefined && p >= settings.threshold &&
                  c.node.isConnected && c.node.data === c.text) {
                try {
                  wrapWhole(c.node, 'ai_classified');
                } catch {
                  // detached
                }
              }
            }
          } finally {
            isMutating = false;
          }
        }
      }

      scanInputs(root);
      reportStats();
    }

    function unblurAll() {
      isMutating = true;
      try {
        for (const span of document.querySelectorAll(`span.${BLUR_CLASS}`)) {
          const parent = span.parentNode;
          if (!parent) continue;
          while (span.firstChild) parent.insertBefore(span.firstChild, span);
          parent.removeChild(span);
          parent.normalize();
        }
        for (const el of document.querySelectorAll(`input.${BLUR_CLASS},textarea.${BLUR_CLASS}`)) {
          el.classList.remove(BLUR_CLASS);
        }
      } finally {
        isMutating = false;
      }
    }

    const pending = new Set<Node>();
    let debounce: number | undefined;
    function scheduleScan() {
      clearTimeout(debounce);
      debounce = window.setTimeout(() => {
        const roots = [...pending];
        pending.clear();
        for (const r of roots) void scanRoot(r);
      }, 150);
    }

    function startObserver() {
      if (observer) return;
      observer = new MutationObserver((mutations) => {
        if (isMutating) return;
        for (const m of mutations) {
          if (insideOurs(m.target)) continue;
          if (m.type === 'characterData') {
            const t = m.target as Text;
            if (pending.has(t)) continue;
            processed.delete(t);
            pending.add(t);
          } else {
            for (const n of m.addedNodes) {
              if (n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.TEXT_NODE) {
                if (!insideOurs(n)) pending.add(n);
              }
            }
          }
        }
        if (pending.size) scheduleScan();
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    function applySettings(next: Settings) {
      const prev = settings;
      settings = next;
      document.documentElement.classList.toggle('mrsecret-hover', next.hoverReveal);
      if (!next.enabled || next.disabledHosts.includes(location.host)) {
        unblurAll();
        observer?.disconnect();
        observer = null;
        reportStats();
        return;
      }
      if (prev && prev.enabled && prev.threshold !== next.threshold) {
        unblurAll();
        void scanRoot(document.documentElement);
        return;
      }
      if (!prev || !prev.enabled) {
        startObserver();
        void scanRoot(document.documentElement);
      }
    }

    chrome.runtime.onMessage.addListener((msg: ExtensionMessage) => {
      if (msg.type === 'SETTINGS_CHANGED') {
        applySettings(msg.settings);
      } else if (msg.type === 'RESCAN') {
        unblurAll();
        void scanRoot(document.documentElement);
      }
    });

    // re-check inputs as the user/types fill them
    document.addEventListener(
      'input',
      (e) => {
        const el = e.target;
        if (el instanceof HTMLInputElement && el.type !== 'password') {
          const spans = detectSecrets(el.value ?? '');
          el.classList.toggle(
            BLUR_CLASS,
            spans.some((s) => s.kind === 'api_key' || s.kind === 'jwt'),
          );
          reportStats();
        }
      },
      true,
    );

    void getSettings().then((s) => {
      settings = s;
      if (!s.enabled || s.disabledHosts.includes(location.host)) return;
      injectStyle();
      startObserver();
      void scanRoot(document.documentElement);
    });
  },
});
