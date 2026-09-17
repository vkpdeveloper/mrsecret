import { describe, expect, it } from 'vitest';
import { VerdictCache, type CacheEntry, type CacheStore } from '../verdict-cache';

function memStore(): CacheStore & { data: Record<string, CacheEntry> } {
  const store = {
    data: {} as Record<string, CacheEntry>,
    async load() {
      return { ...this.data };
    },
    async save(d: Record<string, CacheEntry>) {
      this.data = { ...d };
    },
  };
  return store;
}

function clock() {
  let t = 1000;
  return { now: () => t, tick: (ms = 1) => (t += ms) };
}

describe('VerdictCache', () => {
  it('hits on exact text+context match', async () => {
    const c = new VerdictCache(memStore());
    await c.init();
    c.set('Acme Inc.', 'Workspace: Acme Inc.', 0.9);
    expect(c.get('Acme Inc.', 'Workspace: Acme Inc.')).toBe(0.9);
    expect(c.hits).toBe(1);
  });

  it('decisive verdict hits for same text with different context', async () => {
    const c = new VerdictCache(memStore());
    await c.init();
    c.set('Acme Inc.', 'ctx A', 0.9);
    expect(c.get('Acme Inc.', 'completely different context')).toBe(0.9);
  });

  it('indecisive verdict does NOT hit for different context', async () => {
    const c = new VerdictCache(memStore());
    await c.init();
    c.set('Mercury', 'ctx A', 0.5);
    expect(c.get('Mercury', 'ctx A')).toBe(0.5); // exact hit
    expect(c.get('Mercury', 'ctx B')).toBeUndefined(); // no text-only entry
    expect(c.misses).toBe(1);
  });

  it('evicts oldest entries when over cap', async () => {
    const clk = clock();
    const c = new VerdictCache(memStore(), clk.now, 10);
    await c.init();
    for (let i = 0; i < 12; i++) {
      clk.tick();
      c.set(`text-${i}`, `ctx-${i}`, 0.9);
    }
    // 12 exact + 12 text-only = 24 entries, cap 10 → oldest 20% dropped repeatedly
    expect(c.size()).toBeLessThanOrEqual(10);
    // oldest entries evicted
    expect(c.get('text-0', 'ctx-0')).toBeUndefined();
    // newest retained
    expect(c.get('text-11', 'ctx-11')).toBe(0.9);
  });

  it('loads persisted data on init', async () => {
    const store = memStore();
    const c1 = new VerdictCache(store);
    await c1.init();
    c1.set('secret@x.com', 'ctx', 0.95);
    await c1.flush();

    const c2 = new VerdictCache(store);
    await c2.init();
    expect(c2.get('secret@x.com', 'ctx')).toBe(0.95);
  });

  it('clear empties and persists', async () => {
    const store = memStore();
    const c = new VerdictCache(store);
    await c.init();
    c.set('a', 'b', 0.9);
    await c.clear();
    expect(c.size()).toBe(0);
    expect(store.data).toEqual({});
  });
});
