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
  stepCount: 16 | 32;
  swing: number;   // 0–0.5
  voices: DrumVoiceConfig[];
}

export interface DrumMachineState {
  isOpen: boolean;
  patterns: DrumPattern[];
  activePatternId: string;
  isPlaying: boolean;
  currentStep: number;
  bpm: number;
  syncBpm: boolean;  // link BPM to main sequencer
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export type DrumAction =
  | { type: 'DRUM_OPEN'; open: boolean }
  | { type: 'DRUM_SET_BPM'; bpm: number }
  | { type: 'DRUM_SET_SYNC_BPM'; sync: boolean }
  | { type: 'DRUM_SET_PLAYING'; playing: boolean }
  | { type: 'DRUM_SET_CURRENT_STEP'; step: number }
  | { type: 'DRUM_SET_ACTIVE_PATTERN'; id: string }
  | { type: 'DRUM_TOGGLE_STEP'; patternId: string; voiceId: DrumVoiceType; stepIndex: number }
  | { type: 'DRUM_SET_STEP_PARAMS'; patternId: string; voiceId: DrumVoiceType; stepIndex: number; params: Partial<Pick<DrumStep, 'velocity' | 'pitch' | 'decay'>> }
  | { type: 'DRUM_SET_VOICE_PARAMS'; patternId: string; voiceId: DrumVoiceType; params: Partial<Omit<DrumVoiceConfig, 'id' | 'name' | 'steps' | 'color'>> }
  | { type: 'DRUM_SET_SWING'; patternId: string; swing: number }
  | { type: 'DRUM_SET_STEP_COUNT'; patternId: string; steps: 16 | 32 }
  | { type: 'DRUM_MUTE_VOICE'; patternId: string; voiceId: DrumVoiceType; muted: boolean }
  | { type: 'DRUM_SOLO_VOICE'; patternId: string; voiceId: DrumVoiceType; solo: boolean }
  | { type: 'DRUM_CLEAR_PATTERN'; patternId: string }
  | { type: 'DRUM_ADD_PATTERN' }
  | { type: 'DRUM_DUPLICATE_PATTERN'; sourceId: string }
  | { type: 'DRUM_RENAME_PATTERN'; patternId: string; name: string };

// ─── Default step / voice factories ──────────────────────────────────────────

const VOICE_COLORS: Record<DrumVoiceType, string> = {
  'kick':    '#f97316',
  'snare':   '#eab308',
  'hihat-c': '#22c55e',
  'hihat-o': '#10b981',
  'clap':    '#06b6d4',
  'tom-lo':  '#a855f7',
  'tom-mid': '#8b5cf6',
  'tom-hi':  '#6366f1',
  'crash':   '#f43f5e',
  'ride':    '#fb7185',
  'rim':     '#84cc16',
  'cowbell': '#f59e0b',
  'shaker':  '#64748b',
};

const VOICE_META: { id: DrumVoiceType; name: string }[] = [
  { id: 'kick',    name: 'Kick'   },
  { id: 'snare',   name: 'Snare'  },
  { id: 'hihat-c', name: 'HH C'  },
  { id: 'hihat-o', name: 'HH O'  },
  { id: 'clap',    name: 'Clap'  },
  { id: 'tom-lo',  name: 'Tom L' },
  { id: 'tom-mid', name: 'Tom M' },
  { id: 'tom-hi',  name: 'Tom H' },
  { id: 'crash',   name: 'Crash' },
  { id: 'ride',    name: 'Ride'  },
  { id: 'rim',     name: 'Rim'   },
  { id: 'cowbell', name: 'Cowbel'},
  { id: 'shaker',  name: 'Shakar'},
];

function makeStep(active = false): DrumStep {
  return { active, velocity: 100, pitch: 0, decay: 1 };
}

function makeVoice(id: DrumVoiceType, name: string, count: number, activeSteps: number[] = []): DrumVoiceConfig {
  return {
    id, name,
    color: VOICE_COLORS[id],
    steps: Array.from({ length: count }, (_, i) => makeStep(activeSteps.includes(i))),
    volume: 0.9, pan: 0, tone: 0.5, pitch: 0, decay: 1,
    muted: false, solo: false,
  };
}

// ─── Pre-built patterns ───────────────────────────────────────────────────────

let _patternId = 1;
function pid(): string { return `p-${_patternId++}`; }

function makePattern(name: string, steps: 16 | 32, swing: number,
  data: Partial<Record<DrumVoiceType, number[]>>): DrumPattern {
  return {
    id: pid(), name, stepCount: steps, swing,
    voices: VOICE_META.map(({ id, name: n }) =>
      makeVoice(id, n, steps, data[id] ?? [])
    ),
  };
}

function buildPresets(): DrumPattern[] {
  return [
    makePattern('4/4 Rock', 16, 0, {
      'kick':    [0, 4, 8, 12],
      'snare':   [4, 12],
      'hihat-c': [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],
      'hihat-o': [7, 15],
      'crash':   [0],
    }),

    makePattern('Hip-Hop', 16, 0.28, {
      'kick':    [0, 3, 7, 10, 11],
      'snare':   [4, 12],
      'hihat-c': [0,2,4,6,8,10,12,14],
      'hihat-o': [6],
      'shaker':  [1,3,5,7,9,11,13,15],
    }),

    makePattern('Trap', 16, 0.15, {
      'kick':    [0, 10],
      'snare':   [8],
      'hihat-c': [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],
      'hihat-o': [3, 7, 11, 15],
    }),

    makePattern('House', 16, 0, {
      'kick':    [0, 4, 8, 12],
      'clap':    [4, 12],
      'hihat-c': [2, 6, 10, 14],
      'hihat-o': [3, 7, 11, 15],
      'shaker':  [0,2,4,6,8,10,12,14],
    }),

    makePattern('Jazz', 16, 0.35, {
      'kick':    [0, 6],
      'ride':    [0,2,4,6,8,10,12,14],
      'hihat-c': [4, 12],
      'tom-lo':  [7],
      'tom-mid': [11],
      'rim':     [3, 13],
    }),

    makePattern('Latin Clave', 16, 0, {
      'rim':     [0, 3, 6, 10, 12],
      'shaker':  [0,2,4,6,8,10,12,14],
      'kick':    [0, 8],
      'hihat-c': [0,2,4,6,8,10,12,14],
      'cowbell': [0, 4, 8, 12],
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

    case 'DRUM_SET_STEP_COUNT': {
      const newCount = action.steps;
      return patchPattern(state, action.patternId, (p) => ({
        ...p,
        stepCount: newCount,
        voices: p.voices.map((v) => {
          const steps = Array.from({ length: newCount }, (_, i) =>
            i < v.steps.length ? v.steps[i] : makeStep()
          );
          return { ...v, steps };
        }),
      }));
    }

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
        voices: p.voices.map((v) => ({
          ...v,
          steps: v.steps.map(() => makeStep()),
        })),
      }));

    case 'DRUM_ADD_PATTERN': {
      const base = state.patterns.find((p) => p.id === state.activePatternId)
        ?? state.patterns[0];
      const fresh = makePattern(`Pattern ${state.patterns.length + 1}`, base.stepCount, base.swing, {});
      return {
        ...state,
        patterns: [...state.patterns, fresh],
        activePatternId: fresh.id,
      };
    }

    case 'DRUM_DUPLICATE_PATTERN': {
      const src = state.patterns.find((p) => p.id === action.sourceId);
      if (!src) return state;
      const dup: DrumPattern = {
        ...src,
        id: pid(),
        name: `${src.name} (copy)`,
        voices: src.voices.map((v) => ({
          ...v,
          steps: v.steps.map((s) => ({ ...s })),
        })),
      };
      return {
        ...state,
        patterns: [...state.patterns, dup],
        activePatternId: dup.id,
      };
    }

    case 'DRUM_RENAME_PATTERN':
      return patchPattern(state, action.patternId, (p) => ({ ...p, name: action.name }));

    default:
      return state;
  }
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
        return {
          ...parsed,
          isPlaying: false,
          currentStep: 0,
          // If no patterns saved, re-build presets
          patterns: parsed.patterns?.length ? parsed.patterns : buildPresets(),
        };
      }
    } catch (_) { /* corrupt */ }
    return buildInitialState();
  });

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (_) { /* quota */ }
  }, [state]);

  return { state, dispatch };
}
