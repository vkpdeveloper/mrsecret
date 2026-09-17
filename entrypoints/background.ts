import { hashCandidate } from '@/src/lib/candidates';
import { getSettings, setSettings } from '@/src/lib/settings';
import type {
  Candidate,
  ClassifyResponse,
  ExtensionMessage,
  Settings,
} from '@/src/lib/types';
import { classifyCandidates } from '@/src/lib/typesafe';

const CACHE_KEY = 'classifyCache';
const CACHE_CAP = 2000;
const BATCH_SIZE = 25;
const CONCURRENCY = 3;

const memCache = new Map<string, number>();
const tabStats = new Map<number, { blurred: number; host: string }>();
let cacheLoaded = false;

async function loadCache() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  try {
    const res = await chrome.storage.session.get(CACHE_KEY);
    const obj = res[CACHE_KEY] ?? {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number') memCache.set(k, v);
    }
  } catch {
    // session storage unavailable
  }
}

async function persistCache() {
  if (memCache.size > CACHE_CAP) memCache.clear();
  try {
    await chrome.storage.session.set({ [CACHE_KEY]: Object.fromEntries(memCache) });
  } catch {
    // ignore
  }
}

async function classify(
  settings: Settings,
  pageTitle: string,
  pageUrl: string,
  candidates: Candidate[],
): Promise<ClassifyResponse> {
  if (!settings.useAi || !settings.apiKey) return { ok: false, error: 'no_api_key' };
  await loadCache();

  const results: Record<string, number> = {};
  const missing: Candidate[] = [];
  for (const c of candidates) {
    const h = hashCandidate(c.text, c.context);
    const hit = memCache.get(h);
    if (hit !== undefined) results[c.id] = hit;
    else missing.push(c);
  }

  const batches: Candidate[][] = [];
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    batches.push(missing.slice(i, i + BATCH_SIZE));
  }

  try {
    for (let i = 0; i < batches.length; i += CONCURRENCY) {
      const chunk = batches.slice(i, i + CONCURRENCY);
      const settled = await Promise.all(
        chunk.map((b) => classifyCandidates(settings.apiKey, pageTitle, pageUrl, b)),
      );
      for (let j = 0; j < chunk.length; j++) {
        for (const c of chunk[j]!) {
          const v = settled[j]![c.id];
          if (v !== undefined) {
            results[c.id] = v;
            memCache.set(hashCandidate(c.text, c.context), v);
          }
        }
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  void persistCache();
  return { ok: true, results };
}

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((raw: ExtensionMessage, sender, sendResponse) => {
    (async () => {
      switch (raw.type) {
        case 'CLASSIFY': {
          const settings = await getSettings();
          sendResponse(await classify(settings, raw.pageTitle, raw.pageUrl, raw.candidates));
          break;
        }
        case 'GET_SETTINGS':
          sendResponse(await getSettings());
          break;
        case 'SET_SETTINGS': {
          const next = await setSettings(raw.settings);
          const tabs = await chrome.tabs.query({});
          for (const t of tabs) {
            if (t.id !== undefined) {
              chrome.tabs
                .sendMessage(t.id, { type: 'SETTINGS_CHANGED', settings: next })
                .catch(() => {});
            }
          }
          sendResponse(next);
          break;
        }
        case 'STATS': {
          const tabId = raw.tabId ?? sender.tab?.id;
          if (tabId !== undefined) tabStats.set(tabId, { blurred: raw.blurred, host: raw.host });
          sendResponse({ ok: true });
          break;
        }
        case 'GET_STATS':
          sendResponse(tabStats.get(raw.tabId) ?? { blurred: 0, host: '' });
          break;
        default:
          sendResponse({ ok: false, error: 'unknown_message' });
      }
    })().catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  });

  chrome.tabs.onRemoved.addListener((tabId) => tabStats.delete(tabId));
});
