const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA']);

function inSkippedTree(node: Node): boolean {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (el.hasAttribute('data-mrsecret') || SKIP_TAGS.has(el.tagName)) return true;
  }
  return false;
}

export function collectTextNodes(root: Node): Text[] {
  const doc = root.nodeType === Node.DOCUMENT_NODE ? (root as Document) : root.ownerDocument;
  if (!doc) return [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: Text[] = [];
  let n = walker.nextNode();
  while (n) {
    const t = n as Text;
    if (t.data.trim() && !inSkippedTree(t)) out.push(t);
    n = walker.nextNode();
  }
  return out;
}

export function isCandidateText(text: string): boolean {
  const t = text.trim();
  if (t.length < 2 || t.length > 200) return false;
  if (!/[A-Za-z0-9]/.test(t)) return false;
  if (t.split(/\s+/).length >= 12) return false;
  return true;
}

const BLOCK_TAGS = new Set([
  'DIV', 'P', 'SECTION', 'ARTICLE', 'LI', 'TD', 'TH', 'TR', 'H1', 'H2', 'H3',
  'H4', 'H5', 'H6', 'LABEL', 'SPAN', 'A', 'BUTTON', 'HEADER', 'FOOTER',
  'MAIN', 'ASIDE', 'NAV', 'DD', 'DT', 'FIGCAPTION', 'BODY',
]);

export function buildContext(node: Text): string {
  let block: Element | null = node.parentElement;
  while (block && !BLOCK_TAGS.has(block.tagName)) block = block.parentElement;
  const full = (block?.textContent ?? node.data).replace(/\s+/g, ' ').trim();
  const needle = node.data.trim();
  if (full.length <= 160) return full;
  const idx = full.indexOf(needle);
  const center = idx >= 0 ? idx + needle.length / 2 : 0;
  const start = Math.max(0, Math.round(center - 80));
  return full.slice(start, start + 160);
}

export function hashCandidate(text: string, context: string): string {
  const s = `${text}${context}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
