import { useEffect, useState } from 'react';
import { effectiveThreshold, getSettings } from '@/src/lib/settings';
import type { Settings } from '@/src/lib/types';
import { DEFAULT_SETTINGS } from '@/src/lib/types';
import { Section } from './Section';
import { Toggle } from './Toggle';

export default function App() {
  const [settings, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [host, setHost] = useState('');
  const [tabId, setTabId] = useState<number>();
  const [blurred, setBlurred] = useState(0);
  const [keyDraft, setKeyDraft] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [cacheStats, setCacheStats] = useState<{ entries: number; hits: number; misses: number }>();
  const [loaded, setLoaded] = useState(false);

  async function refreshCacheStats() {
    const stats = (await chrome.runtime
      .sendMessage({ type: 'GET_CACHE_STATS' })
      .catch(() => undefined)) as { entries: number; hits: number; misses: number } | undefined;
    setCacheStats(stats);
  }

  useEffect(() => {
    void (async () => {
      const s = await getSettings();
      setS(s);
      setKeyDraft(s.apiKey);
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== undefined) {
        setTabId(tab.id);
        try {
          setHost(new URL(tab.url ?? '').host);
        } catch {
          setHost('');
        }
        const stats = (await chrome.runtime.sendMessage({
          type: 'GET_STATS',
          tabId: tab.id,
        }).catch(() => undefined)) as { blurred?: number } | undefined;
        setBlurred(stats?.blurred ?? 0);
      }
      await refreshCacheStats();
      setLoaded(true);
    })();
  }, []);

  async function update(partial: Partial<Settings>) {
    const next = await chrome.runtime
      .sendMessage({ type: 'SET_SETTINGS', settings: partial })
      .catch(() => null);
    const merged = (next as Settings | null) ?? { ...settings, ...partial };
    setS(merged);
  }

  const siteDisabled = host ? settings.disabledHosts.includes(host) : false;

  async function toggleSite(disabled: boolean) {
    if (!host) return;
    const hosts = disabled
      ? [...new Set([...settings.disabledHosts, host])]
      : settings.disabledHosts.filter((h) => h !== host);
    await update({ disabledHosts: hosts });
  }

  async function rescan() {
    if (tabId !== undefined) {
      await chrome.tabs.sendMessage(tabId, { type: 'RESCAN' }).catch(() => {});
    }
  }

  async function saveKey() {
    await update({ apiKey: keyDraft.trim() });
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 2000);
  }

  if (!loaded) return <div className="popup" />;

  return (
    <div className="popup">
      <header className="header">
        <span className="logo">M</span>
        <span className="title">Mr. Secret</span>
        <Toggle checked={settings.enabled} onChange={(v) => void update({ enabled: v })} />
      </header>

      <Section>
        <div className="site-row">
          <div className="site-info">
            <span className="host">{host || 'current page'}</span>
            <span className="muted">Blurred: {blurred}</span>
            {host && (
              <span className="muted small">
                Threshold: {effectiveThreshold(settings, host).toFixed(2)}{' '}
                ({host in settings.siteThresholds ? 'site' : 'default'})
              </span>
            )}
          </div>
          <button className="btn" onClick={() => void rescan()}>Rescan</button>
        </div>
        {host && (
          <Toggle
            label="Disabled on this site"
            checked={siteDisabled}
            onChange={(v) => void toggleSite(v)}
          />
        )}
      </Section>

      <Section title="AI classifier">
        <Toggle
          label="Use TypeSafe Jev"
          checked={settings.useAi}
          onChange={(v) => void update({ useAi: v })}
        />
        <div className="key-row">
          <input
            type={showKey ? 'text' : 'password'}
            placeholder="TypeSafe API key"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
          />
          <button className="btn ghost" onClick={() => setShowKey((s) => !s)}>
            {showKey ? 'Hide' : 'Show'}
          </button>
          <button className="btn" onClick={() => void saveKey()}>Save</button>
        </div>
        <div className="muted small">
          {keySaved
            ? 'Key saved'
            : settings.apiKey
              ? 'Key saved'
              : 'No key — regex-only mode'}
          {' · Get a key at typesafe.ai'}
        </div>
        {cacheStats && (
          <div className="cache-row">
            <span className="muted small">
              Cached verdicts: {cacheStats.entries} · hits {cacheStats.hits} / misses{' '}
              {cacheStats.misses}
            </span>
            <button
              className="btn ghost"
              onClick={() =>
                void chrome.runtime
                  .sendMessage({ type: 'CLEAR_CACHE' })
                  .then(() => refreshCacheStats())
              }
            >
              Clear cache
            </button>
          </div>
        )}
      </Section>

      <Section title="Sensitivity">
        <label className="slider-row">
          <span>Default threshold {settings.threshold.toFixed(2)}</span>
          <input
            type="range"
            min={0.4}
            max={0.95}
            step={0.05}
            value={settings.threshold}
            onChange={(e) => void update({ threshold: Number(e.target.value) })}
          />
        </label>
        {host && (
          <>
            <Toggle
              label={`Custom threshold for ${host}`}
              checked={host in settings.siteThresholds}
              onChange={(v) => {
                const siteThresholds = { ...settings.siteThresholds };
                if (v) siteThresholds[host] = settings.threshold;
                else delete siteThresholds[host];
                void update({ siteThresholds });
              }}
            />
            {host in settings.siteThresholds && (
              <label className="slider-row">
                <span>{host} threshold {settings.siteThresholds[host]!.toFixed(2)}</span>
                <input
                  type="range"
                  min={0.4}
                  max={0.95}
                  step={0.05}
                  value={settings.siteThresholds[host]!}
                  onChange={(e) =>
                    void update({
                      siteThresholds: {
                        ...settings.siteThresholds,
                        [host]: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            )}
          </>
        )}
        <Toggle
          label="Reveal on hover"
          checked={settings.hoverReveal}
          onChange={(v) => void update({ hoverReveal: v })}
        />
      </Section>
    </div>
  );
}
