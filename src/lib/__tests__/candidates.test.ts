// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  buildContext,
  collectTextNodes,
  hashCandidate,
  isCandidateText,
} from '../candidates';

function doc(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('collectTextNodes', () => {
  it('collects visible text nodes', () => {
    const d = doc('<div><p>hello <b>world</b></p></div>');
    const texts = collectTextNodes(d).map((t) => t.data.trim());
    expect(texts).toEqual(['hello', 'world']);
  });

  it('skips script/style/noscript/textarea', () => {
    const d = doc(
      '<div><script>var a="sk-abcdefghijklmnop";</script><style>.x{}</style>' +
        '<textarea>secret</textarea><p>visible</p></div>',
    );
    const texts = collectTextNodes(d).map((t) => t.data);
    expect(texts).toEqual(['visible']);
  });

  it('skips nodes inside data-mrsecret elements', () => {
    const d = doc(
      '<div><span data-mrsecret="email">hidden@x.com</span><span>keep me</span></div>',
    );
    const texts = collectTextNodes(d).map((t) => t.data);
    expect(texts).toEqual(['keep me']);
  });

  it('skips whitespace-only nodes', () => {
    const d = doc('<div>   <p>real</p>   </div>');
    expect(collectTextNodes(d).map((t) => t.data)).toEqual(['real']);
  });
});

describe('isCandidateText', () => {
  it('accepts short value-like text', () => {
    expect(isCandidateText('vaibhav@example.com')).toBe(true);
    expect(isCandidateText('org-9fj2K8sLq0')).toBe(true);
    expect(isCandidateText('Acme Robotics Inc.')).toBe(true);
    expect(isCandidateText('$1,240.55')).toBe(true);
  });

  it('rejects long sentences and paragraphs', () => {
    expect(
      isCandidateText(
        'This is a fairly long sentence with many words that should not be considered a secret at all',
      ),
    ).toBe(false);
  });

  it('rejects punctuation-only and empty text', () => {
    expect(isCandidateText('• • •')).toBe(false);
    expect(isCandidateText('   ')).toBe(false);
    expect(isCandidateText('x')).toBe(false);
  });
});

describe('buildContext / hashCandidate', () => {
  it('returns surrounding block text capped at 160 chars', () => {
    const d = doc(`<div><p>${'word '.repeat(60)}<span>needle-text</span></p></div>`);
    const span = d.querySelector('span')!;
    const ctx = buildContext(span.firstChild as Text);
    expect(ctx.length).toBeLessThanOrEqual(160);
    expect(ctx).toContain('needle-text');
  });

  it('hashCandidate is deterministic', () => {
    expect(hashCandidate('a', 'b')).toBe(hashCandidate('a', 'b'));
    expect(hashCandidate('a', 'b')).not.toBe(hashCandidate('a', 'c'));
  });
});
