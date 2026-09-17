import { describe, expect, it } from 'vitest';
import { effectiveThreshold, getSettings } from '../settings';
import { DEFAULT_SETTINGS } from '../types';

describe('effectiveThreshold', () => {
  it('returns site override when present', () => {
    const s = { ...DEFAULT_SETTINGS, threshold: 0.6, siteThresholds: { 'a.com': 0.85 } };
    expect(effectiveThreshold(s, 'a.com')).toBe(0.85);
  });
  it('falls back to global threshold', () => {
    const s = { ...DEFAULT_SETTINGS, threshold: 0.55 };
    expect(effectiveThreshold(s, 'b.com')).toBe(0.55);
  });
  it('getSettings works without chrome and defaults siteThresholds', async () => {
    const s = await getSettings();
    expect(s.siteThresholds).toEqual({});
    expect(s.threshold).toBe(DEFAULT_SETTINGS.threshold);
  });
});
