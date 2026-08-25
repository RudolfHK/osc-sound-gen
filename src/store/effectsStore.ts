import { createContext, useContext, useEffect, useReducer, type Dispatch } from 'react';
import { getEffectsBus, DEFAULT_EFFECTS, type EffectsSettings } from '../engine/effects';

// ─── State ────────────────────────────────────────────────────────────────────

export interface EffectsState extends EffectsSettings {
  isOpen: boolean;
}

export type EffectsAction =
  | { type: 'FX_OPEN'; open: boolean }
  | { type: 'FX_SET'; patch: Partial<EffectsSettings> }
  | { type: 'FX_RESET' };

const INITIAL: EffectsState = { ...DEFAULT_EFFECTS, isOpen: false };

export function effectsReducer(state: EffectsState, action: EffectsAction): EffectsState {
  switch (action.type) {
    case 'FX_OPEN':
      return { ...state, isOpen: action.open };
    case 'FX_SET':
      return { ...state, ...action.patch };
    case 'FX_RESET':
      return { ...DEFAULT_EFFECTS, isOpen: state.isOpen };
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

export function useEffectsReducer(bpm: number): EffectsCtx {
  const [state, dispatch] = useReducer(effectsReducer, INITIAL, (init) => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) return { ...init, ...(JSON.parse(saved) as EffectsState) };
    } catch (_) { /* corrupt or missing */ }
    return init;
  });

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (_) { /* quota */ }
  }, [state]);

  // Push settings into the audio graph. The bus builds itself lazily, so this is
  // a no-op until an AudioContext exists.
  useEffect(() => {
    getEffectsBus().update(state, bpm);
  }, [state, bpm]);

  return { state, dispatch };
}
