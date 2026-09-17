import { DEFAULT_SETTINGS, type Settings } from './types';

const KEY = 'settings';

const hasChrome = typeof chrome !== 'undefined' && !!chrome.storage?.local;

export function effectiveThreshold(s: Settings, host: string): number {
  return s.siteThresholds[host] ?? s.threshold;
}

export async function getSettings(): Promise<Settings> {
  if (!hasChrome) return { ...DEFAULT_SETTINGS };
  const res = await chrome.storage.local.get(KEY);
  return { ...DEFAULT_SETTINGS, ...(res[KEY] ?? {}) };
}

export async function setSettings(partial: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...partial };
  if (hasChrome) await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export function onSettingsChanged(cb: (s: Settings) => void): void {
  if (!hasChrome || !chrome.storage.onChanged) return;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) {
      cb({ ...DEFAULT_SETTINGS, ...(changes[KEY].newValue ?? {}) });
    }
  });
}
