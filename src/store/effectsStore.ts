import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type Dispatch } from 'react';
import { registerHistoryParticipant, requestUndoStep } from './history';
import { getEffectsBus, DEFAULT_EFFECTS, type EffectsSettings } from '../engine/effects';

// ─── State ────────────────────────────────────────────────────────────────────

export interface EffectsState extends EffectsSettings {
  isOpen: boolean;
}

export type EffectsAction =
  | { type: 'FX_OPEN'; open: boolean }
  | { type: 'FX_SET'; patch: Partial<EffectsSettings> }
  | { type: 'FX_RESET' }
  /** Replace every setting — a project load, or undo/redo. */
  | { type: 'FX_LOAD'; settings: EffectsSettings };

const INITIAL: EffectsState = { ...DEFAULT_EFFECTS, isOpen: false };

export function effectsReducer(state: EffectsState, action: EffectsAction): EffectsState {
  switch (action.type) {
    case 'FX_OPEN':
      return { ...state, isOpen: action.open };
    case 'FX_SET':
      return { ...state, ...action.patch };
    case 'FX_RESET':
      return { ...DEFAULT_EFFECTS, isOpen: state.isOpen };
    case 'FX_LOAD':
      return { ...DEFAULT_EFFECTS, ...action.settings, isOpen: state.isOpen };
    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface EffectsCtx {
  state: EffectsState;
  dispatch: Dispatch<EffectsAction>;
}

export const EffectsContext = createContext<EffectsCtx | null>(null);

export function useEffectsStore(): EffectsCtx {
  const ctx = useContext(EffectsContext);
  if (!ctx) throw new Error('useEffectsStore must be inside EffectsContext.Provider');
  return ctx;
}

const LS_KEY = 'osc-effects-state';
const PERSIST_DEBOUNCE_MS = 400;

/** The settings without UI state — what projects and undo store. */
export function effectsSettingsOf(s: EffectsState): EffectsSettings {
  const { isOpen: _o, ...settings } = s;
  return settings;
}

function sameSettings(a: EffectsSettings, b: EffectsSettings): boolean {
  return (Object.keys(a) as (keyof EffectsSettings)[]).every((k) => a[k] === b[k]);
}

export function useEffectsReducer(bpm: number): EffectsCtx {
  const [state, rawDispatch] = useReducer(effectsReducer, INITIAL, (init) => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) return { ...init, ...(JSON.parse(saved) as EffectsState) };
    } catch (_) { /* corrupt or missing */ }
    return init;
  });

  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    const id = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify(latest.current)); } catch (_) { /* quota */ }
    }, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [state]);

  // The master effects are part of the song, so they share its undo history.
  // The snapshot keeps its identity while the settings are unchanged, so an
  // undo step doesn't count opening the panel as an edit.
  const snap = useRef<EffectsSettings>(effectsSettingsOf(state));
  useEffect(() => registerHistoryParticipant<EffectsSettings>({
    id: 'fx',
    snapshot: () => {
      const now = effectsSettingsOf(latest.current);
      if (!sameSettings(now, snap.current)) snap.current = now;
      return snap.current;
    },
    restore: (settings) => rawDispatch({ type: 'FX_LOAD', settings }),
  }), []);

  const dispatch = useCallback<Dispatch<EffectsAction>>((action) => {
    if (action.type === 'FX_SET') requestUndoStep(`fx:${Object.keys(action.patch).sort().join(',')}`);
    if (action.type === 'FX_RESET') requestUndoStep(null);
    rawDispatch(action);
  }, []);

  // Push settings into the audio graph. The bus builds itself lazily, so this is
  // a no-op until an AudioContext exists.
  useEffect(() => {
    getEffectsBus().update(state, bpm);
  }, [state, bpm]);

  return useMemo(() => ({ state, dispatch }), [state, dispatch]);
}
