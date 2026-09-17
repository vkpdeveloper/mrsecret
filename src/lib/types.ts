export type SecretKind =
  | 'api_key'
  | 'email'
  | 'phone'
  | 'card'
  | 'iban'
  | 'jwt'
  | 'ai_classified';

export interface Candidate {
  id: string;
  text: string;
  context: string; // surrounding text up to ~160 chars
}

export interface ClassifyRequest {
  type: 'CLASSIFY';
  pageTitle: string;
  pageUrl: string;
  candidates: Candidate[];
}

export type ClassifyResponse =
  | { ok: true; results: Record<string, number> } // id -> probability
  | { ok: false; error: string };

export interface Settings {
  apiKey: string;
  enabled: boolean;
  threshold: number;
  hoverReveal: boolean;
  disabledHosts: string[];
  useAi: boolean;
  siteThresholds: Record<string, number>; // host -> threshold
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  enabled: true,
  threshold: 0.6,
  hoverReveal: true,
  disabledHosts: [],
  useAi: true,
  siteThresholds: {},
};

export interface GetSettingsMessage {
  type: 'GET_SETTINGS';
}

export interface SetSettingsMessage {
  type: 'SET_SETTINGS';
  settings: Partial<Settings>;
}

export interface SettingsChangedMessage {
  type: 'SETTINGS_CHANGED';
  settings: Settings;
}

export interface StatsMessage {
  type: 'STATS';
  tabId?: number;
  blurred: number;
  host: string;
}

export interface GetStatsMessage {
  type: 'GET_STATS';
  tabId: number;
}

export interface RescanMessage {
  type: 'RESCAN';
}

export interface GetCacheStatsMessage {
  type: 'GET_CACHE_STATS';
}

export interface ClearCacheMessage {
  type: 'CLEAR_CACHE';
}

export type ExtensionMessage =
  | ClassifyRequest
  | GetSettingsMessage
  | SetSettingsMessage
  | SettingsChangedMessage
  | StatsMessage
  | GetStatsMessage
  | RescanMessage
  | GetCacheStatsMessage
  | ClearCacheMessage;
