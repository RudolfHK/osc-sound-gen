/**
 * The user's own sounds: a factory preset plus saved settings, under a name.
 * Self-contained (library edits to the factory preset don't change them), so
 * a sound saved today plays the same in a year and on someone else's machine.
 *
 * Also: favourites and recently used lists, and preset packs — a small JSON
 * file to share sounds.
 */
import { OVERRIDE_FIELDS, PRESETS_BY_ID } from '../engine/instruments';
import { uid, type InstrumentPatch } from './music';

export interface UserPreset {
  id: string;
  name: string;
  /** The factory preset it starts from. */
  base: string;
  patch: InstrumentPatch;
  createdAt: string;
}

export const USER_PRESET_PREFIX = 'user-';
export const MAX_RECENTS = 12;
export const PACK_FORMAT = 'osc-preset-pack';

export const isUserPresetId = (id: string) => id.startsWith(USER_PRESET_PREFIX);

export function makeUserPreset(name: string, base: string, patch: InstrumentPatch): UserPreset {
  return { id: uid('user'), name: cleanName(name), base, patch: cleanPatch(patch), createdAt: new Date().toISOString() };
}

const cleanName = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, 60) || 'My sound';

/** Only known settings, as finite numbers inside each setting's range. */
export function cleanPatch(raw: unknown): InstrumentPatch {
  const out: InstrumentPatch = {};
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;
  for (const f of OVERRIDE_FIELDS) {
    const v = src[f.key];
    if (typeof v === 'number' && Number.isFinite(v)) out[f.key] = Math.max(f.min, Math.min(f.max, v));
  }
  return out;
}

/** A user preset from a file or storage, or null if it can't be one. */
export function parseUserPreset(raw: unknown): UserPreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !isUserPresetId(r.id) || r.id.length > 80) return null;
  if (typeof r.base !== 'string' || !PRESETS_BY_ID.has(r.base)) return null;
  if (typeof r.name !== 'string') return null;
  return {
    id: r.id,
    name: cleanName(r.name),
    base: r.base,
    patch: cleanPatch(r.patch),
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date(0).toISOString(),
  };
}

const samePreset = (a: UserPreset, b: UserPreset) =>
  a.name === b.name && a.base === b.base && JSON.stringify(cleanPatch(a.patch)) === JSON.stringify(cleanPatch(b.patch));

/**
 * Add `incoming` to `existing`. A preset already there unchanged is skipped;
 * one whose id is taken by a different sound gets a new id (`idMap` says
 * which); a name already in use gets a number.
 */
export function mergePresets(existing: UserPreset[], incoming: UserPreset[]): {
  presets: UserPreset[]; added: UserPreset[]; idMap: Record<string, string>;
} {
  const presets = [...existing];
  const added: UserPreset[] = [];
  const idMap: Record<string, string> = {};
  for (const p of incoming) {
    const same = presets.find((x) => x.id === p.id);
    if (same && samePreset(same, p)) continue;
    const identical = presets.find((x) => samePreset(x, p));
    if (identical) { idMap[p.id] = identical.id; continue; }
    const id = same ? uid('user') : p.id;
    let name = p.name;
    for (let n = 2; presets.some((x) => x.name === name); n++) name = `${p.name} (${n})`;
    const next = { ...p, id, name };
    if (id !== p.id) idMap[p.id] = id;
    presets.push(next);
    added.push(next);
  }
  return { presets, added, idMap };
}

// ─── Packs ────────────────────────────────────────────────────────────────────

export interface PresetPack {
  format: typeof PACK_FORMAT;
  version: 1;
  name: string;
  presets: UserPreset[];
}

export function makePack(name: string, presets: UserPreset[]): PresetPack {
  return { format: PACK_FORMAT, version: 1, name: cleanName(name), presets: presets.map((p) => ({ ...p, patch: cleanPatch(p.patch) })) };
}

/** A pack from a file: its valid presets, and how many entries were not. */
export function parsePack(raw: unknown): { name: string; presets: UserPreset[]; skipped: number } {
  if (!raw || typeof raw !== 'object' || (raw as { format?: unknown }).format !== PACK_FORMAT) {
    throw new Error('That file isn\'t a preset pack.');
  }
  const r = raw as { name?: unknown; presets?: unknown };
  const list = Array.isArray(r.presets) ? r.presets : [];
  const presets = list.map(parseUserPreset).filter((p): p is UserPreset => !!p);
  return { name: typeof r.name === 'string' ? cleanName(r.name) : 'Preset pack', presets, skipped: list.length - presets.length };
}

// ─── Favourites and recents ───────────────────────────────────────────────────

export function toggleFavorite(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** Most recent first, no repeats, at most MAX_RECENTS. */
export function pushRecent(list: string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, MAX_RECENTS);
}

/** A list of preset ids from storage: strings only, no repeats. */
export function parseIdList(raw: unknown, max = 500): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((x): x is string => typeof x === 'string' && x.length < 100))].slice(0, max);
}
