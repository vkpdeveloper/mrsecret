import { hashCandidate } from './candidates';

export interface CacheEntry {
  p: number; // probability
  t: number; // lastUsed ms
}

export interface CacheStore {
  load(): Promise<Record<string, CacheEntry>>;
  save(data: Record<string, CacheEntry>): Promise<void>;
}

export const DECISIVE_HI = 0.85;
export const DECISIVE_LO = 0.15;
export const CACHE_CAP = 5000;

const FLUSH_DELAY = 1000;

export class VerdictCache {
  hits = 0;
  misses = 0;
  private data: Record<string, CacheEntry> = {};
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private store: CacheStore,
    private now: () => number = Date.now,
    private cap: number = CACHE_CAP,
  ) {}

  async init(): Promise<void> {
    this.data = { ...(await this.store.load()) };
  }

  size(): number {
    return Object.keys(this.data).length;
  }

  get(text: string, context: string): number | undefined {
    const t = text.trim();
    const exact = this.data[`x:${hashCandidate(t, context)}`];
    const broad = this.data[`t:${hashCandidate(t, '')}`];
    const entry = exact ?? broad;
    if (!entry) {
      this.misses++;
      return undefined;
    }
    entry.t = this.now();
    this.hits++;
    return entry.p;
  }

  set(text: string, context: string, p: number): void {
    const t = text.trim();
    const now = this.now();
    this.data[`x:${hashCandidate(t, context)}`] = { p, t: now };
    if (p >= DECISIVE_HI || p <= DECISIVE_LO) {
      this.data[`t:${hashCandidate(t, '')}`] = { p, t: now };
    }
    this.evict();
    this.scheduleFlush();
  }

  async clear(): Promise<void> {
    this.data = {};
    await this.flush();
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.store.save(this.data);
  }

  private evict(): void {
    const keys = Object.keys(this.data);
    if (keys.length <= this.cap) return;
    keys.sort((a, b) => this.data[a]!.t - this.data[b]!.t);
    const drop = Math.ceil(keys.length * 0.2);
    for (const k of keys.slice(0, drop)) delete this.data[k];
  }

  private scheduleFlush(): void {
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => void this.flush(), FLUSH_DELAY);
  }
}
