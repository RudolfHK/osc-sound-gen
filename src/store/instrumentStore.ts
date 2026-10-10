import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch } from 'react';
import { getInstrumentEngine, type InstrumentOverride, type InstrumentCategory } from '../engine/instruments';
import { getSequencerEngine } from '../engine/sequencer';

// ─── State ────────────────────────────────────────────────────────────────────

export interface InstrumentLibraryState {
  isOpen: boolean;
  category: InstrumentCategory | 'ALL';
  search: string;
  /** presetId → user parameter tweaks */
  overrides: Record<string, InstrumentOverride>;
}

export type InstrumentAction =
  | { type: 'INST_OPEN'; open: boolean }
  | { type: 'INST_SET_CATEGORY'; category: InstrumentCategory | 'ALL' }
  | { type: 'INST_SET_SEARCH'; search: string }
  | { type: 'INST_SET_OVERRIDE'; presetId: string; patch: InstrumentOverride }
  | { type: 'INST_RESET_OVERRIDE'; presetId: string };

const INITIAL: InstrumentLibraryState = {
  isOpen: false,
  category: 'ALL',
  search: '',
  overrides: {},
};

// ─── Reducer ──────────────────────────────────────────────────────────────────

export function instrumentReducer(
  state: InstrumentLibraryState,
  action: InstrumentAction,
): InstrumentLibraryState {
  switch (action.type) {
    case 'INST_OPEN':
      return { ...state, isOpen: action.open };

    case 'INST_SET_CATEGORY':
      return { ...state, category: action.category };

    case 'INST_SET_SEARCH':
      return { ...state, search: action.search };

    case 'INST_SET_OVERRIDE':
      return {
        ...state,
        overrides: {
          ...state.overrides,
          [action.presetId]: { ...state.overrides[action.presetId], ...action.patch },
        },
      };

    case 'INST_RESET_OVERRIDE': {
      const next = { ...state.overrides };
      delete next[action.presetId];
      return { ...state, overrides: next };
    }

    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface InstrumentCtx {
  state: InstrumentLibraryState;
  dispatch: Dispatch<InstrumentAction>;
}

export const InstrumentContext = createContext<InstrumentCtx | null>(null);

export function useInstrumentStore(): InstrumentCtx {
  const ctx = useContext(InstrumentContext);
  if (!ctx) throw new Error('useInstrumentStore must be inside InstrumentContext.Provider');
  return ctx;
}

const LS_KEY = 'osc-instrument-state';

export function useInstrumentReducer(): InstrumentCtx {
  const [state, dispatch] = useReducer(instrumentReducer, INITIAL, (init) => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as InstrumentLibraryState & { assignments?: unknown };
        // `assignments` belonged to the pre-v2 model; the app store migrates it
        const { assignments: _legacy, ...rest } = parsed;
        return { ...init, ...rest, search: '' };
      }
    } catch (_) { /* corrupt or missing */ }
    return init;
  });

  // Debounced, and only for what is worth keeping (not the search box)
  const { isOpen, category, overrides } = state;
  useEffect(() => {
    const id = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify({ isOpen, category, overrides })); } catch (_) { /* quota */ }
    }, 400);
    return () => clearTimeout(id);
  }, [isOpen, category, overrides]);

  // Push overrides into the audio engine so the sequencer sees them whether or
  // not the library panel is mounted. (Which preset a track plays now lives on
  // the track itself.)
  useEffect(() => {
    getInstrumentEngine().setOverrides(state.overrides);
    // A library edit to width or sends changes what the tracks' strips apply
    getSequencerEngine().refreshMix();
  }, [state.overrides]);

  return useMemo(() => ({ state, dispatch }), [state]);
}
