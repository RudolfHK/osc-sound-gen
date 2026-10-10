import { describe, it, expect, beforeEach, vi } from 'vitest';

// A fresh module per test: the state is module-level
async function load() {
  vi.resetModules();
  return import('./projectState');
}

describe('unsaved-changes tracking', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
  });

  it('the first document seen is the saved one', async () => {
    const p = await load();
    const tracks = [{}];
    p.trackDocument([tracks, 120]);
    expect(p.getProjectStatus().dirty).toBe(false);
    p.trackDocument([tracks, 121]);
    expect(p.getProjectStatus().dirty).toBe(true);
  });

  it('undoing back to the saved objects reads as saved again', async () => {
    const p = await load();
    const saved = [{}];
    p.trackDocument([saved]);
    p.trackDocument([[{}]]);
    expect(p.getProjectStatus().dirty).toBe(true);
    p.trackDocument([saved]);
    expect(p.getProjectStatus().dirty).toBe(false);
  });

  it('saving makes the current document the saved one', async () => {
    const p = await load();
    p.trackDocument([1]);
    p.trackDocument([2]);
    p.markSaved('song.oscproject');
    expect(p.getProjectStatus()).toEqual({ dirty: false, fileName: 'song.oscproject' });
    p.trackDocument([3]);
    expect(p.getProjectStatus().dirty).toBe(true);
  });

  it('a replaced project starts clean from its first document', async () => {
    const p = await load();
    p.trackDocument([1]);
    p.trackDocument([2]);
    p.markReplaced('other.oscproject');
    expect(p.getProjectStatus()).toEqual({ dirty: false, fileName: 'other.oscproject' });
    p.trackDocument([5]);
    expect(p.getProjectStatus().dirty).toBe(false);
  });

  it('unsaved work stays unsaved across a reload', async () => {
    let p = await load();
    p.trackDocument([1]);
    p.trackDocument([2]);
    expect(p.getProjectStatus().dirty).toBe(true);
    p = await load();            // the page reloads; storage survives
    p.trackDocument([2]);
    expect(p.getProjectStatus().dirty).toBe(true);
    p.markSaved('x.oscproject');
    p = await load();
    p.trackDocument([2]);
    expect(p.getProjectStatus().dirty).toBe(false);
  });
});
