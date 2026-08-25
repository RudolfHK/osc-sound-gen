import { createContext, useContext, useEffect, useReducer, type Dispatch } from 'react';
import type { DrumVoiceType } from '../engine/sampler';

// ─── Data model ───────────────────────────────────────────────────────────────

export interface DrumStep {
  active: boolean;
  velocity: number;  // 1–127
  pitch: number;     // -12 to +12 semitones
  decay: number;     // 0.2–2.0 multiplier
}

export interface DrumVoiceConfig {
  id: DrumVoiceType;
  name: string;
  steps: DrumStep[];
  volume: number;   // 0–1
  pan: number;      // -1 to 1
  tone: number;     // 0–1
  pitch: number;    // -12 to +12
  decay: number;    // 0.2–2.0
  muted: boolean;
  solo: boolean;
  color: string;
}

export interface DrumPattern {
  id: string;
  name: string;
  genre: string;
  stepCount: 16 | 32;
  swing: number;   // 0–0.5
  voices: DrumVoiceConfig[];
}

export type VoiceGroup = 'KIT' | 'CYMBAL' | 'PERC' | 'FX';

export interface DrumMachineState {
  isOpen: boolean;
  patterns: DrumPattern[];
  activePatternId: string;
  isPlaying: boolean;
  currentStep: number;
  bpm: number;
  syncBpm: boolean;       // link BPM to main sequencer
  voiceFilter: VoiceGroup | 'ALL';
  schemaVersion: number;
}

/** Bump when VOICE_META or the preset list changes so saved state gets migrated. */
const SCHEMA_VERSION = 2;

// ─── Actions ──────────────────────────────────────────────────────────────────

export type DrumAction =
  | { type: 'DRUM_OPEN'; open: boolean }
  | { type: 'DRUM_SET_BPM'; bpm: number }
  | { type: 'DRUM_SET_SYNC_BPM'; sync: boolean }
  | { type: 'DRUM_SET_PLAYING'; playing: boolean }
  | { type: 'DRUM_SET_CURRENT_STEP'; step: number }
  | { type: 'DRUM_SET_ACTIVE_PATTERN'; id: string }
  | { type: 'DRUM_SET_VOICE_FILTER'; filter: VoiceGroup | 'ALL' }
  | { type: 'DRUM_TOGGLE_STEP'; patternId: string; voiceId: DrumVoiceType; stepIndex: number }
  | { type: 'DRUM_SET_STEP_PARAMS'; patternId: string; voiceId: DrumVoiceType; stepIndex: number; params: Partial<Pick<DrumStep, 'velocity' | 'pitch' | 'decay'>> }
  | { type: 'DRUM_SET_VOICE_PARAMS'; patternId: string; voiceId: DrumVoiceType; params: Partial<Omit<DrumVoiceConfig, 'id' | 'name' | 'steps' | 'color'>> }
  | { type: 'DRUM_SET_SWING'; patternId: string; swing: number }
  | { type: 'DRUM_SET_STEP_COUNT'; patternId: string; steps: 16 | 32 }
  | { type: 'DRUM_MUTE_VOICE'; patternId: string; voiceId: DrumVoiceType; muted: boolean }
  | { type: 'DRUM_SOLO_VOICE'; patternId: string; voiceId: DrumVoiceType; solo: boolean }
  | { type: 'DRUM_CLEAR_PATTERN'; patternId: string }
  | { type: 'DRUM_CLEAR_VOICE'; patternId: string; voiceId: DrumVoiceType }
  | { type: 'DRUM_ADD_PATTERN' }
  | { type: 'DRUM_DUPLICATE_PATTERN'; sourceId: string }
  | { type: 'DRUM_DELETE_PATTERN'; patternId: string }
  | { type: 'DRUM_RENAME_PATTERN'; patternId: string; name: string };

// ─── Voice catalogue ──────────────────────────────────────────────────────────

interface VoiceMeta {
  id: DrumVoiceType;
  name: string;
  group: VoiceGroup;
  color: string;
}

export const VOICE_META: VoiceMeta[] = [
  // ── Core kit ──
  { id: 'kick',        name: 'Kick',    group: 'KIT',    color: '#f97316' },
  { id: 'kick-808',    name: '808 Kck', group: 'KIT',    color: '#fb923c' },
  { id: 'kick-tight',  name: 'Tgt Kck', group: 'KIT',    color: '#ea580c' },
  { id: 'snare',       name: 'Snare',   group: 'KIT',    color: '#eab308' },
  { id: 'snare-808',   name: '808 Snr', group: 'KIT',    color: '#facc15' },
  { id: 'snare-brush', name: 'Brush',   group: 'KIT',    color: '#ca8a04' },
  { id: 'hihat-c',     name: 'HH Clsd', group: 'KIT',    color: '#22c55e' },
  { id: 'hihat-o',     name: 'HH Open', group: 'KIT',    color: '#10b981' },
  { id: 'hihat-pedal', name: 'HH Pdl',  group: 'KIT',    color: '#059669' },
  { id: 'clap',        name: 'Clap',    group: 'KIT',    color: '#06b6d4' },
  { id: 'rim',         name: 'Rim',     group: 'KIT',    color: '#84cc16' },
  { id: 'snap',        name: 'Snap',    group: 'KIT',    color: '#a3e635' },
  { id: 'tom-lo',      name: 'Tom Lo',  group: 'KIT',    color: '#a855f7' },
  { id: 'tom-mid',     name: 'Tom Md',  group: 'KIT',    color: '#8b5cf6' },
  { id: 'tom-hi',      name: 'Tom Hi',  group: 'KIT',    color: '#6366f1' },
  // ── Cymbals ──
  { id: 'crash',       name: 'Crash',   group: 'CYMBAL', color: '#f43f5e' },
  { id: 'splash',      name: 'Splash',  group: 'CYMBAL', color: '#fb7185' },
  { id: 'ride',        name: 'Ride',    group: 'CYMBAL', color: '#e11d48' },
  { id: 'ride-bell',   name: 'Rd Bell', group: 'CYMBAL', color: '#f472b6' },
  { id: 'cymbal-rev',  name: 'Rev Cym', group: 'CYMBAL', color: '#ec4899' },
  // ── Percussion ──
  { id: 'cowbell',     name: 'Cowbell', group: 'PERC',   color: '#f59e0b' },
  { id: 'shaker',      name: 'Shaker',  group: 'PERC',   color: '#64748b' },
  { id: 'cabasa',      name: 'Cabasa',  group: 'PERC',   color: '#94a3b8' },
  { id: 'tambourine',  name: 'Tambrn',  group: 'PERC',   color: '#cbd5e1' },
  { id: 'conga-hi',    name: 'Conga H', group: 'PERC',   color: '#d97706' },
  { id: 'conga-lo',    name: 'Conga L', group: 'PERC',   color: '#b45309' },
  { id: 'bongo',       name: 'Bongo',   group: 'PERC',   color: '#f0abfc' },
  { id: 'timbale',     name: 'Timbale', group: 'PERC',   color: '#c084fc' },
  { id: 'woodblock',   name: 'Wdblock', group: 'PERC',   color: '#78716c' },
  { id: 'clave',       name: 'Clave',   group: 'PERC',   color: '#a8a29e' },
  { id: 'triangle',    name: 'Triangl', group: 'PERC',   color: '#fde047' },
  // ── FX ──
  { id: 'zap',         name: 'Zap',     group: 'FX',     color: '#38bdf8' },
  { id: 'sub-drop',    name: 'Sub Drp', group: 'FX',     color: '#0ea5e9' },
];

export const VOICE_GROUPS: (VoiceGroup | 'ALL')[] = ['ALL', 'KIT', 'CYMBAL', 'PERC', 'FX'];

const META_BY_ID = new Map(VOICE_META.map((m) => [m.id, m]));

// ─── Factories ────────────────────────────────────────────────────────────────

function makeStep(active = false, velocity = 100): DrumStep {
  return { active, velocity, pitch: 0, decay: 1 };
}

function makeVoice(
  meta: VoiceMeta,
  count: number,
  activeSteps: number[] = [],
  ghostSteps: number[] = [],
): DrumVoiceConfig {
  const active = new Set(activeSteps);
  const ghost = new Set(ghostSteps);
  return {
    id: meta.id,
    name: meta.name,
    color: meta.color,
    steps: Array.from({ length: count }, (_, i) =>
      ghost.has(i) ? makeStep(true, 48) : makeStep(active.has(i))
    ),
    volume: 0.9, pan: 0, tone: 0.5, pitch: 0, decay: 1,
    muted: false, solo: false,
  };
}

let _patternId = 1;
function pid(): string { return `p-${_patternId++}`; }

/** `hits` maps a voice to its accented steps; `ghosts` to low-velocity steps. */
function makePattern(
  name: string,
  genre: string,
  steps: 16 | 32,
  swing: number,
  hits: Partial<Record<DrumVoiceType, number[]>>,
  ghosts: Partial<Record<DrumVoiceType, number[]>> = {},
): DrumPattern {
  return {
    id: pid(), name, genre, stepCount: steps, swing,
    voices: VOICE_META.map((m) => makeVoice(m, steps, hits[m.id] ?? [], ghosts[m.id] ?? [])),
  };
}

const ALL16 = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15];
const EVEN16 = [0,2,4,6,8,10,12,14];
const ODD16 = [1,3,5,7,9,11,13,15];

// ─── Pre-built pattern library ────────────────────────────────────────────────

function buildPresets(): DrumPattern[] {
  return [
    // ── Rock / Pop ──
    makePattern('4/4 Rock', 'Rock', 16, 0, {
      'kick': [0, 4, 8, 12], 'snare': [4, 12], 'hihat-c': ALL16,
      'hihat-o': [7, 15], 'crash': [0],
    }),
    makePattern('Punk Drive', 'Rock', 16, 0, {
      'kick': [0, 2, 4, 6, 8, 10, 12, 14], 'snare': [4, 12],
      'hihat-c': ALL16, 'crash': [0, 8],
    }),
    makePattern('Metal Blast', 'Rock', 16, 0, {
      'kick': ALL16, 'snare': [2, 6, 10, 14], 'hihat-c': EVEN16,
      'crash': [0], 'ride': [8],
    }),
    makePattern('Ballad', 'Rock', 16, 0, {
      'kick': [0, 8], 'snare': [4, 12], 'hihat-c': EVEN16,
      'ride': [0, 4, 8, 12], 'crash': [0],
    }),
    makePattern('Half-Time Shuffle', 'Rock', 16, 0.34, {
      'kick': [0, 7, 10], 'snare': [8], 'hihat-c': ALL16,
    }, {
      'snare': [2, 5, 11, 13],
    }),

    // ── Hip-Hop / Trap ──
    makePattern('Hip-Hop', 'Hip-Hop', 16, 0.28, {
      'kick': [0, 3, 7, 10, 11], 'snare': [4, 12], 'hihat-c': EVEN16,
      'hihat-o': [6], 'shaker': ODD16,
    }),
    makePattern('Boom Bap', 'Hip-Hop', 16, 0.24, {
      'kick': [0, 6, 10], 'snare': [4, 12], 'hihat-c': EVEN16,
      'rim': [14],
    }, {
      'snare': [7, 15],
    }),
    makePattern('Lo-Fi Chill', 'Hip-Hop', 16, 0.32, {
      'kick': [0, 10], 'snare-brush': [4, 12], 'hihat-c': EVEN16,
      'shaker': ODD16, 'rim': [6],
    }),
    makePattern('Trap', 'Hip-Hop', 16, 0.15, {
      'kick-808': [0, 10], 'snare-808': [8], 'hihat-c': ALL16,
      'hihat-o': [3, 7, 11, 15],
    }),
    makePattern('Trap Rolls', 'Hip-Hop', 32, 0.1, {
      'kick-808': [0, 6, 20], 'snare-808': [16],
      'hihat-c': [0,2,4,6,8,10,12,14,16,17,18,19,20,22,24,25,26,27,28,29,30,31],
      'hihat-o': [7, 23], 'clap': [16],
    }),

    // ── Electronic ──
    makePattern('House', 'Electronic', 16, 0, {
      'kick': [0, 4, 8, 12], 'clap': [4, 12], 'hihat-c': [2, 6, 10, 14],
      'hihat-o': ODD16, 'shaker': EVEN16,
    }),
    makePattern('Deep House', 'Electronic', 16, 0.12, {
      'kick': [0, 4, 8, 12], 'clap': [4, 12], 'hihat-o': ODD16,
      'rim': [6, 14], 'shaker': EVEN16, 'conga-hi': [11],
    }),
    makePattern('Techno', 'Electronic', 16, 0, {
      'kick-tight': [0, 4, 8, 12], 'hihat-c': EVEN16, 'hihat-o': ODD16,
      'clap': [4, 12], 'rim': [6, 14], 'zap': [15],
    }),
    makePattern('Electro', 'Electronic', 16, 0, {
      'kick': [0, 3, 8, 11], 'snare-808': [4, 12], 'hihat-c': ALL16,
      'cowbell': [6, 14], 'zap': [15],
    }),
    makePattern('Synthwave', 'Electronic', 16, 0, {
      'kick': [0, 6, 8, 14], 'snare': [4, 12], 'hihat-c': EVEN16,
      'tom-lo': [10], 'crash': [0], 'cymbal-rev': [15],
    }),
    makePattern('Dubstep', 'Electronic', 16, 0, {
      'kick': [0, 10], 'snare': [8], 'hihat-c': [2, 6, 10, 14],
      'sub-drop': [8], 'crash': [0],
    }),
    makePattern('UK Garage', 'Electronic', 16, 0.36, {
      'kick': [0, 6, 10], 'snare': [4, 12], 'hihat-c': ALL16,
      'hihat-o': [3, 11], 'shaker': ODD16,
    }),
    makePattern('Drum & Bass', 'Electronic', 32, 0, {
      'kick': [0, 10, 16, 26], 'snare': [8, 24], 'hihat-c': EVEN16.concat([16,18,20,22,24,26,28,30]),
      'hihat-o': [14, 30], 'crash': [0],
    }, {
      'snare': [5, 13, 21, 29],
    }),
    makePattern('Amen Break', 'Electronic', 32, 0, {
      'kick': [0, 10, 18], 'snare': [4, 12, 20, 28], 'hihat-c': EVEN16.concat([16,18,20,22,24,26,28,30]),
      'ride': [8, 24], 'crash': [0],
    }, {
      'snare': [7, 15, 22, 26, 30],
    }),
    makePattern('Breakbeat', 'Electronic', 16, 0, {
      'kick': [0, 6, 9], 'snare': [4, 12], 'hihat-c': ALL16,
      'hihat-o': [7], 'crash': [0],
    }, {
      'snare': [14],
    }),

    // ── Funk / Soul ──
    makePattern('Funk', 'Funk', 16, 0.18, {
      'kick': [0, 5, 8, 14], 'snare': [4, 12], 'hihat-c': ALL16,
      'hihat-o': [10],
    }, {
      'snare': [2, 6, 9, 15],
    }),
    makePattern('Motown', 'Funk', 16, 0.2, {
      'kick': [0, 8], 'snare': [4, 12], 'tambourine': EVEN16,
      'hihat-c': ALL16, 'clap': [4, 12],
    }),
    makePattern('Disco', 'Funk', 16, 0, {
      'kick': [0, 4, 8, 12], 'snare': [4, 12], 'hihat-c': EVEN16,
      'hihat-o': ODD16, 'tambourine': EVEN16, 'crash': [0],
    }),
    makePattern('Shuffle Blues', 'Funk', 16, 0.4, {
      'kick': [0, 8], 'snare': [4, 12], 'ride': ALL16,
      'hihat-pedal': [4, 12],
    }),

    // ── Jazz ──
    makePattern('Jazz Swing', 'Jazz', 16, 0.35, {
      'kick': [0, 6], 'ride': EVEN16, 'hihat-pedal': [4, 12],
      'tom-lo': [7], 'rim': [3, 13],
    }, {
      'snare-brush': [2, 10],
    }),
    makePattern('Jazz Brush', 'Jazz', 16, 0.38, {
      'snare-brush': [0, 4, 8, 12], 'ride': EVEN16, 'kick': [0],
      'hihat-pedal': [4, 12],
    }, {
      'snare-brush': [2, 6, 10, 14],
    }),
    makePattern('Bossa Nova', 'Latin', 16, 0.08, {
      'kick': [0, 3, 8, 11], 'rim': [0, 3, 6, 10, 12],
      'hihat-c': EVEN16, 'shaker': ALL16,
    }),

    // ── Latin / World ──
    makePattern('Latin Clave', 'Latin', 16, 0, {
      'clave': [0, 3, 6, 10, 12], 'shaker': EVEN16, 'kick': [0, 8],
      'hihat-c': EVEN16, 'cowbell': [0, 4, 8, 12],
      'conga-hi': [6, 14], 'conga-lo': [2, 10],
    }),
    makePattern('Salsa', 'Latin', 16, 0, {
      'clave': [0, 3, 6, 10, 12], 'cowbell': EVEN16,
      'conga-hi': [3, 7, 11, 15], 'conga-lo': [2, 10],
      'timbale': [4, 12], 'cabasa': ALL16,
    }),
    makePattern('Samba', 'Latin', 16, 0, {
      'kick': [0, 3, 4, 7, 8, 11, 12, 15], 'shaker': ALL16,
      'conga-hi': [2, 6, 10, 14], 'conga-lo': [0, 8],
      'tambourine': EVEN16, 'clave': [0, 3, 6, 10, 12],
    }),
    makePattern('Reggaeton', 'Latin', 16, 0, {
      'kick': [0, 4, 8, 12], 'snare': [3, 6, 11, 14],
      'hihat-c': EVEN16, 'clap': [3, 11], 'shaker': ODD16,
    }),
    makePattern('Cumbia', 'Latin', 16, 0, {
      'kick': [0, 8], 'snare': [4, 12], 'conga-hi': [2, 6, 10, 14],
      'conga-lo': [0, 8], 'cowbell': [4, 12], 'shaker': EVEN16,
      'woodblock': [6, 14],
    }),
    makePattern('Afrobeat', 'World', 16, 0.14, {
      'kick': [0, 6, 8, 14], 'rim': [2, 5, 10, 13],
      'hihat-c': ALL16, 'shaker': EVEN16,
      'conga-hi': [3, 7, 11, 15], 'conga-lo': [0, 8],
      'bongo': [6, 14],
    }),
    makePattern('Marching', 'World', 16, 0, {
      'snare': [0, 2, 4, 6, 8, 10, 12, 14], 'kick': [0, 4, 8, 12],
      'crash': [0], 'timbale': [12],
    }, {
      'snare': ODD16,
    }),
  ];
}

// ─── Initial state ────────────────────────────────────────────────────────────

function buildInitialState(): DrumMachineState {
  const patterns = buildPresets();
  return {
    isOpen: false,
    patterns,
    activePatternId: patterns[0].id,
    isPlaying: false,
    currentStep: 0,
    bpm: 120,
    syncBpm: true,
    voiceFilter: 'ALL',
    schemaVersion: SCHEMA_VERSION,
  };
}

// ─── Migration ────────────────────────────────────────────────────────────────

function resizeSteps(steps: DrumStep[], count: number): DrumStep[] {
  return Array.from({ length: count }, (_, i) =>
    i < steps.length ? steps[i] : makeStep()
  );
}

/**
 * Bring saved state up to the current schema without destroying user work:
 * add voices that didn't exist when the pattern was saved, refresh names and
 * colors, and append any preset patterns the user doesn't already have.
 */
function migrate(saved: DrumMachineState): DrumMachineState {
  const patterns: DrumPattern[] = (saved.patterns ?? []).map((p) => ({
    ...p,
    genre: p.genre ?? 'User',
    voices: VOICE_META.map((meta) => {
      const existing = p.voices?.find((v) => v.id === meta.id);
      if (existing) {
        return {
          ...existing,
          name: meta.name,
          color: meta.color,
          steps: resizeSteps(existing.steps, p.stepCount),
        };
      }
      return makeVoice(meta, p.stepCount);
    }),
  }));

  const known = new Set(patterns.map((p) => p.name));
  const missing = buildPresets().filter((p) => !known.has(p.name));
  const merged = [...patterns, ...missing];

  const activeValid = merged.some((p) => p.id === saved.activePatternId);

  return {
    ...saved,
    patterns: merged,
    activePatternId: activeValid ? saved.activePatternId : merged[0].id,
    voiceFilter: saved.voiceFilter ?? 'ALL',
    isPlaying: false,
    currentStep: 0,
    schemaVersion: SCHEMA_VERSION,
  };
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

function patchPattern(
  state: DrumMachineState,
  patternId: string,
  patcher: (p: DrumPattern) => DrumPattern,
): DrumMachineState {
  return {
    ...state,
    patterns: state.patterns.map((p) => p.id === patternId ? patcher(p) : p),
  };
}

function patchVoice(
  pattern: DrumPattern,
  voiceId: DrumVoiceType,
  patcher: (v: DrumVoiceConfig) => DrumVoiceConfig,
): DrumPattern {
  return {
    ...pattern,
    voices: pattern.voices.map((v) => v.id === voiceId ? patcher(v) : v),
  };
}

export function drumReducer(state: DrumMachineState, action: DrumAction): DrumMachineState {
  switch (action.type) {

    case 'DRUM_OPEN':
      return { ...state, isOpen: action.open };

    case 'DRUM_SET_BPM':
      return { ...state, bpm: Math.max(20, Math.min(300, action.bpm)) };

    case 'DRUM_SET_SYNC_BPM':
      return { ...state, syncBpm: action.sync };

    case 'DRUM_SET_PLAYING':
      return { ...state, isPlaying: action.playing };

    case 'DRUM_SET_CURRENT_STEP':
      return { ...state, currentStep: action.step };

    case 'DRUM_SET_ACTIVE_PATTERN':
      return { ...state, activePatternId: action.id };

    case 'DRUM_SET_VOICE_FILTER':
      return { ...state, voiceFilter: action.filter };

    case 'DRUM_TOGGLE_STEP':
      return patchPattern(state, action.patternId, (p) =>
        patchVoice(p, action.voiceId, (v) => ({
          ...v,
          steps: v.steps.map((s, i) =>
            i === action.stepIndex ? { ...s, active: !s.active } : s
          ),
        }))
      );

    case 'DRUM_SET_STEP_PARAMS':
      return patchPattern(state, action.patternId, (p) =>
        patchVoice(p, action.voiceId, (v) => ({
          ...v,
          steps: v.steps.map((s, i) =>
            i === action.stepIndex ? { ...s, ...action.params } : s
          ),
        }))
      );

    case 'DRUM_SET_VOICE_PARAMS':
      return patchPattern(state, action.patternId, (p) =>
        patchVoice(p, action.voiceId, (v) => ({ ...v, ...action.params }))
      );

    case 'DRUM_SET_SWING':
      return patchPattern(state, action.patternId, (p) =>
        ({ ...p, swing: Math.max(0, Math.min(0.5, action.swing)) })
      );

    case 'DRUM_SET_STEP_COUNT':
      return patchPattern(state, action.patternId, (p) => ({
        ...p,
        stepCount: action.steps,
        voices: p.voices.map((v) => ({ ...v, steps: resizeSteps(v.steps, action.steps) })),
      }));

    case 'DRUM_MUTE_VOICE':
      return patchPattern(state, action.patternId, (p) =>
        patchVoice(p, action.voiceId, (v) => ({ ...v, muted: action.muted }))
      );

    case 'DRUM_SOLO_VOICE':
      return patchPattern(state, action.patternId, (p) => ({
        ...p,
        voices: p.voices.map((v) => ({
          ...v,
          solo: v.id === action.voiceId ? action.solo : false,
        })),
      }));

    case 'DRUM_CLEAR_PATTERN':
      return patchPattern(state, action.patternId, (p) => ({
        ...p,
        voices: p.voices.map((v) => ({ ...v, steps: v.steps.map(() => makeStep()) })),
      }));

    case 'DRUM_CLEAR_VOICE':
      return patchPattern(state, action.patternId, (p) =>
        patchVoice(p, action.voiceId, (v) => ({ ...v, steps: v.steps.map(() => makeStep()) }))
      );

    case 'DRUM_ADD_PATTERN': {
      const base = state.patterns.find((p) => p.id === state.activePatternId)
        ?? state.patterns[0];
      const fresh = makePattern(
        `Pattern ${state.patterns.length + 1}`, 'User',
        base?.stepCount ?? 16, base?.swing ?? 0, {},
      );
      return { ...state, patterns: [...state.patterns, fresh], activePatternId: fresh.id };
    }

    case 'DRUM_DUPLICATE_PATTERN': {
      const src = state.patterns.find((p) => p.id === action.sourceId);
      if (!src) return state;
      const dup: DrumPattern = {
        ...src,
        id: pid(),
        name: `${src.name} (copy)`,
        genre: 'User',
        voices: src.voices.map((v) => ({ ...v, steps: v.steps.map((s) => ({ ...s })) })),
      };
      return { ...state, patterns: [...state.patterns, dup], activePatternId: dup.id };
    }

    case 'DRUM_DELETE_PATTERN': {
      if (state.patterns.length <= 1) return state;
      const idx = state.patterns.findIndex((p) => p.id === action.patternId);
      const remaining = state.patterns.filter((p) => p.id !== action.patternId);
      const nextActive = state.activePatternId === action.patternId
        ? (remaining[Math.max(0, idx - 1)]?.id ?? remaining[0].id)
        : state.activePatternId;
      return { ...state, patterns: remaining, activePatternId: nextActive };
    }

    case 'DRUM_RENAME_PATTERN':
      return patchPattern(state, action.patternId, (p) => ({ ...p, name: action.name }));

    default:
      return state;
  }
}

// ─── Helpers for the UI ───────────────────────────────────────────────────────

export function voiceGroupOf(id: DrumVoiceType): VoiceGroup {
  return META_BY_ID.get(id)?.group ?? 'KIT';
}

/** Patterns grouped by genre, for the pattern picker. */
export function patternsByGenre(patterns: DrumPattern[]): [string, DrumPattern[]][] {
  const map = new Map<string, DrumPattern[]>();
  for (const p of patterns) {
    const g = p.genre || 'User';
    const list = map.get(g);
    if (list) list.push(p); else map.set(g, [p]);
  }
  return [...map.entries()];
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface DrumCtx {
  state: DrumMachineState;
  dispatch: Dispatch<DrumAction>;
}

export const DrumContext = createContext<DrumCtx | null>(null);

export function useDrumStore(): DrumCtx {
  const ctx = useContext(DrumContext);
  if (!ctx) throw new Error('useDrumStore must be inside DrumContext.Provider');
  return ctx;
}

const LS_KEY = 'osc-drum-state';

export function useDrumReducer(): DrumCtx {
  const [state, dispatch] = useReducer(drumReducer, undefined, () => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as DrumMachineState;
        if (parsed.patterns?.length) return migrate(parsed);
      }
    } catch (_) { /* corrupt or missing */ }
    return buildInitialState();
  });

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (_) { /* quota */ }
  }, [state]);

  return { state, dispatch };
}
