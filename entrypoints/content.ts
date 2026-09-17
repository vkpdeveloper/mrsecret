import { buildContext, collectShadowRoots, collectTextNodes, isCandidateText } from '@/src/lib/candidates';
import { detectSecrets } from '@/src/lib/detectors';
import type { ClassifyResponse, ExtensionMessage, Settings } from '@/src/lib/types';
import { effectiveThreshold, getSettings } from '@/src/lib/settings';

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

    const BASE_CSS = `.${BLUR_CLASS}{filter:blur(6px);-webkit-filter:blur(6px);border-radius:3px;transition:filter 120ms ease;user-select:none}`;
    const injectedShadow = new WeakSet<ShadowRoot>();

    function injectStyle() {
      if (!document.getElementById(STYLE_ID)) {
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent =
          BASE_CSS + `.mrsecret-hover .${BLUR_CLASS}:hover{filter:none;-webkit-filter:none}`;
        (document.head ?? document.documentElement).appendChild(style);
      }
      for (const sr of collectShadowRoots(document)) {
        if (injectedShadow.has(sr)) continue;
        injectedShadow.add(sr);
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent =
          BASE_CSS +
          `:host-context(.mrsecret-hover) .${BLUR_CLASS}:hover{filter:none;-webkit-filter:none}`;
        sr.appendChild(style);
      }
    }

    function send(msg: ExtensionMessage): Promise<unknown> {
      return chrome.runtime.sendMessage(msg).catch(() => undefined);
    }

    let statsTimer: number | undefined;
    function reportStats() {
      clearTimeout(statsTimer);
      statsTimer = window.setTimeout(() => {
        let blurred = document.querySelectorAll(`.${BLUR_CLASS}`).length;
        for (const sr of collectShadowRoots(document)) {
          blurred += sr.querySelectorAll(`.${BLUR_CLASS}`).length;
        }
        void send({
          type: 'STATS',
          blurred,
          host: location.host,
        });
      }, 300);
    }

    function insideOurs(node: Node): boolean {
      let el: Element | null =
        node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      while (el) {
        if (el.hasAttribute?.('data-mrsecret') || el.id === STYLE_ID) return true;
        if (!el.parentElement) {
          const r = el.getRootNode();
          el = r instanceof ShadowRoot ? r.host : null;
        } else {
          el = el.parentElement;
        }
      }
      return false;
    }

    function wrapRange(node: Text, start: number, end: number, kind: string): Text {
      const mid = node.splitText(start);
      const tail = mid.splitText(end - start);
      const span = document.createElement('span');
      span.className = BLUR_CLASS;
      span.dataset.mrsecret = kind;
      span.title = TITLE;
      mid.parentNode?.replaceChild(span, mid);
      span.appendChild(mid);
      processed.add(mid);
      processed.add(tail);
      return tail;
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
      observeShadowRoots();
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
            const leftovers: Text[] = [];
            // wrap spans right-to-left so offsets stay valid
            for (let i = spans.length - 1; i >= 0; i--) {
              const s = spans[i]!;
              try {
                leftovers.push(wrapRange(node, s.start, s.end, s.kind));
              } catch {
                // node changed concurrently
              }
            }
            leftovers.push(node); // head: text before the first span
            for (const t of leftovers) {
              if (isCandidateText(t.data) && /[A-Za-z]/.test(t.data)) {
                candidates.push({
                  node: t,
                  text: t.data,
                  id: `c${nextId++}`,
                  context: buildContext(t),
                });
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
              if (p !== undefined && p >= effectiveThreshold(settings, location.host) &&
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
        const roots: (Document | ShadowRoot)[] = [document, ...collectShadowRoots(document)];
        for (const r of roots) {
          for (const span of r.querySelectorAll(`span.${BLUR_CLASS}`)) {
            const parent = span.parentNode;
            if (!parent) continue;
            while (span.firstChild) parent.insertBefore(span.firstChild, span);
            parent.removeChild(span);
            parent.normalize();
          }
          for (const el of r.querySelectorAll(`input.${BLUR_CLASS},textarea.${BLUR_CLASS}`)) {
            el.classList.remove(BLUR_CLASS);
          }
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

    const OBSERVE_OPTS = { childList: true, subtree: true, characterData: true };
    let observedRoots = new WeakSet<Node>();

    function observeRoot(root: Node) {
      if (!observer || observedRoots.has(root)) return;
      observedRoots.add(root);
      observer.observe(root, OBSERVE_OPTS);
    }

    function observeShadowRoots() {
      for (const sr of collectShadowRoots(document)) observeRoot(sr);
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
                if (insideOurs(n)) continue;
                pending.add(n);
                const sr = (n as Element).shadowRoot;
                if (sr) {
                  observeRoot(sr);
                  pending.add(sr);
                }
              }
            }
          }
        }
        if (pending.size) scheduleScan();
      });
      observeRoot(document.documentElement);
      observeShadowRoots();
    }

    function applySettings(next: Settings) {
      const prev = settings;
      settings = next;
      document.documentElement.classList.toggle('mrsecret-hover', next.hoverReveal);
      if (!next.enabled || next.disabledHosts.includes(location.host)) {
        unblurAll();
        observer?.disconnect();
        observer = null;
        observedRoots = new WeakSet();
        reportStats();
        return;
      }
      const wasActive = !!prev && prev.enabled && !prev.disabledHosts.includes(location.host);
      if (
        wasActive &&
        effectiveThreshold(prev!, location.host) !== effectiveThreshold(next, location.host)
      ) {
        unblurAll();
        void scanRoot(document.documentElement);
        return;
      }
      if (!wasActive) {
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
