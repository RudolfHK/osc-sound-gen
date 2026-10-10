/**
 * App preferences — not part of any project. Kept outside React so the audio
 * engine can read them too; components subscribe with `useSettings()`.
 */
import { useSyncExternalStore } from 'react';
import type { SnapValue } from '../utils/music';

export type LatencyHint = 'interactive' | 'balanced' | 'playback';
export type FollowMode = 'page' | 'scroll' | 'off';

export interface Settings {
  // ── Audio ──
  /** Output device id; '' is the system default. */
  outputDeviceId: string;
  latencyHint: LatencyHint;
  /** Lighter sound engine for slow machines: mono width, shorter tails, slower meters. */
  ecoMode: boolean;
  /** Turn Eco mode on by itself when audio dropouts are detected. */
  autoEco: boolean;
  // ── New projects ──
  newTempo: number;
  newSnap: SnapValue;
  newNoteLength: SnapValue;
  /** What "New project" starts from: the starter tracks, nothing, or a template id. */
  newStart: string;
  // ── Editing ──
  followPlayhead: FollowMode;
  /** Octave of the A key on the computer-keyboard piano (4 → A plays C4). */
  keyboardOctave: number;
  /** Metronome click level, 0–1. */
  metronomeLevel: number;
  /** Bars of count-in before playback when the metronome is on. */
  countIn: 0 | 1 | 2;
  // ── Saving ──
  /** Write to the project's file every N minutes while there are changes (0 = off). */
  autosaveMinutes: number;
  // ── Appearance ──
  /** Interface zoom, 0.9–1.5. */
  uiScale: number;
  /** Show the welcome screen every time the app starts (it always shows on the first). */
  welcomeOnStart: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  outputDeviceId: '',
  latencyHint: 'interactive',
  ecoMode: false,
  autoEco: true,
  newTempo: 120,
  newSnap: '1/16',
  newNoteLength: '1/8',
  newStart: 'starter',
  followPlayhead: 'page',
  keyboardOctave: 4,
  metronomeLevel: 0.6,
  countIn: 0,
  autosaveMinutes: 0,
  uiScale: 1,
  welcomeOnStart: false,
};

const KEY = 'osc-settings';
let settings: Settings = read();
const listeners = new Set<() => void>();

function read(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function getSettings(): Settings {
  return settings;
}

export function updateSettings(patch: Partial<Settings>): void {
  const next = { ...settings, ...patch };
  if ((Object.keys(patch) as (keyof Settings)[]).every((k) => next[k] === settings[k])) return;
  settings = next;
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
  for (const l of listeners) l();
}

export function subscribeSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, () => settings, () => settings);
}
