import { createContext, useContext, useEffect, useReducer, type Dispatch } from 'react';
import { getInstrumentEngine, type InstrumentOverride, type InstrumentCategory } from '../engine/instruments';

// ─── State ────────────────────────────────────────────────────────────────────

export interface InstrumentLibraryState {
  isOpen: boolean;
  category: InstrumentCategory | 'ALL';
  search: string;
  /** tabId → presetId. A track with an assignment plays through the instrument engine. */
  assignments: Record<string, string>;
  /** presetId → user parameter tweaks */
  overrides: Record<string, InstrumentOverride>;
}

export type InstrumentAction =
  | { type: 'INST_OPEN'; open: boolean }
  | { type: 'INST_SET_CATEGORY'; category: InstrumentCategory | 'ALL' }
  | { type: 'INST_SET_SEARCH'; search: string }
  | { type: 'INST_ASSIGN'; tabId: string; presetId: string }
  | { type: 'INST_UNASSIGN'; tabId: string }
  | { type: 'INST_SET_OVERRIDE'; presetId: string; patch: InstrumentOverride }
  | { type: 'INST_RESET_OVERRIDE'; presetId: string };

const INITIAL: InstrumentLibraryState = {
  isOpen: false,
  category: 'ALL',
  search: '',
  assignments: {},
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

    case 'INST_ASSIGN':
      return {
        ...state,
        assignments: { ...state.assignments, [action.tabId]: action.presetId },
      };

    case 'INST_UNASSIGN': {
      const next = { ...state.assignments };
      delete next[action.tabId];
      return { ...state, assignments: next };
    }

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
        const parsed = JSON.parse(saved) as InstrumentLibraryState;
        return { ...init, ...parsed, search: '' };
      }
    } catch (_) { /* corrupt or missing */ }
    return init;
  });

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (_) { /* quota */ }
  }, [state]);

  // Push assignments/overrides into the audio engine so the sequencer sees them
  // whether or not the library panel is mounted.
  useEffect(() => {
    getInstrumentEngine().setAssignments(state.assignments);
  }, [state.assignments]);

  useEffect(() => {
    getInstrumentEngine().setOverrides(state.overrides);
  }, [state.overrides]);

  return { state, dispatch };
}
