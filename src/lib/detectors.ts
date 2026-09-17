import type { SecretKind } from './types';

export interface Span {
  start: number;
  end: number;
  kind: SecretKind;
}

export function entropy(s: string): number {
  if (!s.length) return 0;
  const freq = new Map<string, number>();
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

interface Rule {
  kind: SecretKind;
  re: RegExp;
  ok?: (m: string) => boolean;
}

const KEY_PATTERNS = [
  'sk-proj-[A-Za-z0-9_-]{16,}',
  'sk-ant-[A-Za-z0-9_-]{16,}',
  'sk-[A-Za-z0-9_-]{16,}',
  'AKIA[0-9A-Z]{16}',
  '(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}',
  'github_pat_[A-Za-z0-9_]{60,}',
  'xox[baprs]-[A-Za-z0-9-]{10,}',
  'AIza[0-9A-Za-z_-]{35}',
  'apikey_[A-Za-z0-9_]{20,}',
  '(?:pk|sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}',
  'glpat-[A-Za-z0-9_-]{20,}',
  'hf_[A-Za-z0-9]{30,}',
  '-----BEGIN [A-Z ]*PRIVATE KEY-----',
];

const RULES: Rule[] = [
  { kind: 'api_key', re: new RegExp(`(?:${KEY_PATTERNS.join('|')})`, 'g') },
  { kind: 'jwt', re: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  { kind: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: 'iban', re: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g },
  {
    kind: 'card',
    re: /\b(?:\d[ -]?){13,19}\b/g,
    ok: (m) => {
      const digits = m.replace(/\D/g, '');
      return digits.length >= 13 && digits.length <= 19 && luhn(digits);
    },
  },
  {
    kind: 'phone',
    re: /\+?\d[\d\s().-]{8,}\d/g,
    ok: (m) => {
      const n = m.replace(/\D/g, '').length;
      return n >= 10 && n <= 15;
    },
  },
  {
    kind: 'api_key',
    re: /\b[A-Za-z0-9_-]{32,}\b/g,
    ok: (m) => /[A-Za-z]/.test(m) && /\d/.test(m) && entropy(m) > 3.5,
  },
];

function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start < last.end) {
      if (s.end > last.end) last.end = s.end;
      continue;
    }
    out.push({ ...s });
  }
  return out;
}

export function leftoverSegments(text: string, spans: Span[]): string[] {
  const out: string[] = [];
  let pos = 0;
  for (const s of spans) {
    if (s.start > pos) out.push(text.slice(pos, s.start));
    pos = Math.max(pos, s.end);
  }
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

export function detectSecrets(text: string): Span[] {
  const spans: Span[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text))) {
      if (!m[0]) {
        rule.re.lastIndex++;
        continue;
      }
      if (rule.ok && !rule.ok(m[0])) continue;
      spans.push({ start: m.index, end: m.index + m[0].length, kind: rule.kind });
    }
  }
  return mergeSpans(spans);
}
