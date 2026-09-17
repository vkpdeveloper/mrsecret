import { describe, expect, it } from 'vitest';
import { detectSecrets, entropy, luhn } from '../detectors';

const kinds = (text: string) => detectSecrets(text).map((s) => s.kind);

describe('detectSecrets', () => {
  it('matches OpenAI-style keys', () => {
    const k = 'sk-' + 'aB3xY9'.repeat(4);
    expect(kinds(`key: ${k}`)).toContain('api_key');
    expect(kinds(`sk-proj-${'x'.repeat(40)}`)).toContain('api_key');
    expect(kinds(`sk-ant-${'x'.repeat(40)}`)).toContain('api_key');
  });

  it('matches AWS, GitHub, Slack, Google, Stripe, GitLab, HF keys', () => {
    expect(kinds('AKIAIOSFODNN7EXAMPLE')).toContain('api_key');
    expect(kinds('ghp_' + 'a'.repeat(36))).toContain('api_key');
    expect(kinds('github_pat_' + 'a'.repeat(60))).toContain('api_key');
    expect(kinds('xoxb-1234567890-abcdefghij')).toContain('api_key');
    expect(kinds('AIza' + 'a'.repeat(35))).toContain('api_key');
    expect(kinds('sk_live_' + 'a'.repeat(24))).toContain('api_key');
    expect(kinds('pk_test_' + 'a'.repeat(24))).toContain('api_key');
    expect(kinds('glpat-' + 'a'.repeat(20))).toContain('api_key');
    expect(kinds('hf_' + 'a'.repeat(30))).toContain('api_key');
    expect(kinds('-----BEGIN RSA PRIVATE KEY-----')).toContain('api_key');
  });

  it('rejects too-short sk- tokens', () => {
    expect(detectSecrets('sk-1234')).toHaveLength(0);
  });

  it('matches emails', () => {
    expect(kinds('contact vaibhav@example.com today')).toContain('email');
  });

  it('does not match generic UI labels', () => {
    expect(detectSecrets('Settings Billing Usage')).toHaveLength(0);
  });

  it('detects Luhn-valid cards only', () => {
    expect(kinds('4242 4242 4242 4242')).toContain('card');
    expect(detectSecrets('1234 5678 9012 3456')).toHaveLength(0);
  });

  it('matches JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(kinds(`Bearer ${jwt}`)).toContain('jwt');
  });

  it('matches high-entropy generic tokens, rejects low-entropy', () => {
    expect(kinds('a9F3kL0pQ2xZ7vB1nM4rT8yU6wE5sD3c')).toContain('api_key');
    expect(detectSecrets('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toHaveLength(0);
  });

  it('matches IBANs and phones', () => {
    expect(kinds('IBAN: DE89370400440532013000')).toContain('iban');
    expect(kinds('call +1 (415) 555-2671 now')).toContain('phone');
  });

  it('merges overlapping spans preferring earlier/longer', () => {
    const text = 'sk-proj-' + 'K9x'.repeat(20);
    const spans = detectSecrets(text);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.end - spans[0]!.start).toBe(text.length);
  });
});

describe('helpers', () => {
  it('luhn validates checksums', () => {
    expect(luhn('4242424242424242')).toBe(true);
    expect(luhn('1234567890123456')).toBe(false);
  });
  it('entropy scores character diversity', () => {
    expect(entropy('aaaa')).toBe(0);
    expect(entropy('a9F3kL0pQ2xZ7vB1')).toBeGreaterThan(3.5);
  });
});
