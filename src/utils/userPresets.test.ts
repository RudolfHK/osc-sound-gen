import { describe, it, expect } from 'vitest';
import {
  cleanPatch, makePack, makeUserPreset, mergePresets, parseIdList, parsePack, parseUserPreset, pushRecent, toggleFavorite,
  MAX_RECENTS,
} from './userPresets';
import { instrumentReducer, type InstrumentLibraryState } from '../store/instrumentStore';
import { getInstrumentEngine, PRESETS_BY_ID } from '../engine/instruments';

const lib = (): InstrumentLibraryState => ({ isOpen: false, category: 'ALL', search: '', overrides: {}, favorites: [], recents: [], userPresets: [] });

describe('user presets', () => {
  it('keeps only known settings, clamped to their ranges', () => {
    expect(cleanPatch({ cutoff: 99999, attack: -1, volume: 0.5, bogus: 3, release: 'x', drive: NaN }))
      .toEqual({ cutoff: 16000, attack: 0.001, volume: 0.5 });
  });

  it('parses a stored preset and rejects ones that cannot play', () => {
    const p = makeUserPreset('  Big   Bass ', 'bass-saw', { cutoff: 900 });
    expect(p.name).toBe('Big Bass');
    expect(parseUserPreset(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(parseUserPreset({ ...p, base: 'no-such-preset' })).toBeNull();
    expect(parseUserPreset({ ...p, id: 'bass-saw' })).toBeNull(); // not a user id
    expect(parseUserPreset(null)).toBeNull();
  });

  it('merges: skips duplicates, renumbers names, re-ids clashing sounds', () => {
    const a = makeUserPreset('Lead', 'lead-saw', { cutoff: 2000 });
    const b = makeUserPreset('Pad', 'pad-warm', {});
    const first = mergePresets([], [a, b]);
    expect(first.added).toHaveLength(2);
    // Same again: nothing added
    expect(mergePresets(first.presets, [a]).added).toEqual([]);
    // Same id, different sound (edited elsewhere): a new id, mapped, and a new name
    const changed = { ...a, patch: { cutoff: 500 } };
    const m = mergePresets(first.presets, [changed]);
    expect(m.added).toHaveLength(1);
    expect(m.added[0].id).not.toBe(a.id);
    expect(m.idMap[a.id]).toBe(m.added[0].id);
    expect(m.added[0].name).toBe('Lead (2)');
    // A different id for the same sound maps onto the one already there
    const twin = { ...b, id: 'user-twin' };
    expect(mergePresets(first.presets, [twin])).toMatchObject({ added: [], idMap: { 'user-twin': b.id } });
  });

  it('round-trips a pack and skips bad entries', () => {
    const a = makeUserPreset('Lead', 'lead-saw', { cutoff: 2000 });
    const raw = JSON.parse(JSON.stringify(makePack('Mine', [a])));
    raw.presets.push({ id: 'user-x', name: 'Broken', base: 'nope' }, 42);
    const pack = parsePack(raw);
    expect(pack).toMatchObject({ name: 'Mine', skipped: 2 });
    expect(pack.presets).toEqual([a]);
    expect(() => parsePack({ format: 'osc-project' })).toThrow(/isn't a preset pack/);
  });

  it('keeps favourites as a toggle and recents newest first, capped', () => {
    expect(toggleFavorite(toggleFavorite([], 'a'), 'a')).toEqual([]);
    let r: string[] = [];
    for (let i = 0; i < 20; i++) r = pushRecent(r, `p${i}`);
    r = pushRecent(r, 'p15');
    expect(r[0]).toBe('p15');
    expect(r).toHaveLength(MAX_RECENTS);
    expect(new Set(r).size).toBe(r.length);
    expect(parseIdList(['a', 'a', 3, 'b'])).toEqual(['a', 'b']);
  });
});

describe('the library store', () => {
  it('edits a user sound directly instead of adding a library layer, and deleting it clears lists', () => {
    const p = makeUserPreset('Lead', 'lead-saw', { cutoff: 2000 });
    let s = instrumentReducer(lib(), { type: 'INST_ADD_USER_PRESETS', presets: [p] });
    s = instrumentReducer(s, { type: 'INST_TOGGLE_FAVORITE', presetId: p.id });
    s = instrumentReducer(s, { type: 'INST_USED', presetId: p.id });
    s = instrumentReducer(s, { type: 'INST_SET_OVERRIDE', presetId: p.id, patch: { cutoff: 3000 } });
    expect(s.overrides).toEqual({});
    expect(s.userPresets[0].patch.cutoff).toBe(3000);
    s = instrumentReducer(s, { type: 'INST_DELETE_USER_PRESET', id: p.id });
    expect(s).toMatchObject({ userPresets: [], favorites: [], recents: [] });
  });
});

describe('the engine plays user presets', () => {
  it('resolves a user preset as its base plus its settings, under its own name', () => {
    const p = makeUserPreset('Dark Saw', 'bass-saw', { cutoff: 300, release: 1.5 });
    const engine = getInstrumentEngine();
    engine.setUserPresets([p]);
    const r = engine.resolve(p.id)!;
    expect(r).toMatchObject({ id: p.id, name: 'Dark Saw', category: PRESETS_BY_ID.get('bass-saw')!.category });
    expect(r.filter.cutoff).toBe(300);
    expect(r.amp.release).toBe(1.5);
    // A track's own settings go on top
    expect(engine.resolve(p.id, { cutoff: 900 })!.filter.cutoff).toBe(900);
    // Library edits to the base don't reach it
    engine.setOverrides({ 'bass-saw': { release: 0.2 } });
    expect(engine.resolve(p.id)!.amp.release).toBe(1.5);
    expect(engine.info(p.id)).toMatchObject({ name: 'Dark Saw', base: 'bass-saw', user: true });
    engine.setOverrides({});
    engine.setUserPresets([]);
    expect(engine.resolve(p.id)).toBeNull();
  });
});
