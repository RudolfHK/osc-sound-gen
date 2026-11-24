import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type Dispatch } from 'react';
import { getInstrumentEngine, type InstrumentOverride, type InstrumentCategory } from '../engine/instruments';
import { getSequencerEngine } from '../engine/sequencer';
import {
  mergePresets, parseIdList, parseUserPreset, pushRecent, toggleFavorite, cleanPatch, type UserPreset,
} from '../utils/userPresets';
import type { InstrumentPatch } from '../utils/music';

// ─── State ────────────────────────────────────────────────────────────────────

/** What the library shows: everything, a category, or one of the user's lists. */
export type LibraryView = InstrumentCategory | 'ALL' | 'FAVORITES' | 'RECENT' | 'MINE';

export interface InstrumentLibraryState {
  isOpen: boolean;
  category: LibraryView;
  search: string;
  /** presetId → user parameter tweaks */
  overrides: Record<string, InstrumentOverride>;
  /** Preset ids (factory or the user's), in the order they were starred. */
  favorites: string[];
  /** Sounds most recently given to a track, newest first. */
  recents: string[];
  /** The user's own sounds. */
  userPresets: UserPreset[];
}

export type InstrumentAction =
  | { type: 'INST_OPEN'; open: boolean }
  | { type: 'INST_SET_CATEGORY'; category: LibraryView }
  | { type: 'INST_SET_SEARCH'; search: string }
  | { type: 'INST_SET_OVERRIDE'; presetId: string; patch: InstrumentOverride }
  | { type: 'INST_RESET_OVERRIDE'; presetId: string }
  | { type: 'INST_TOGGLE_FAVORITE'; presetId: string }
  | { type: 'INST_USED'; presetId: string }
  /** Add sounds (saved, imported, or carried by a project); duplicates are skipped. */
  | { type: 'INST_ADD_USER_PRESETS'; presets: UserPreset[] }
  | { type: 'INST_UPDATE_USER_PRESET'; id: string; name?: string; patch?: InstrumentPatch }
  | { type: 'INST_DELETE_USER_PRESET'; id: string };

const INITIAL: InstrumentLibraryState = {
  isOpen: false,
  category: 'ALL',
  search: '',
  overrides: {},
  favorites: [],
  recents: [],
  userPresets: [],
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
      // A user's own sound has no library layer: editing it edits the sound
      if (state.userPresets.some((p) => p.id === action.presetId)) {
        return instrumentReducer(state, { type: 'INST_UPDATE_USER_PRESET', id: action.presetId, patch: action.patch });
      }
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

    case 'INST_TOGGLE_FAVORITE':
      return { ...state, favorites: toggleFavorite(state.favorites, action.presetId) };

    case 'INST_USED':
      return state.recents[0] === action.presetId ? state : { ...state, recents: pushRecent(state.recents, action.presetId) };

    case 'INST_ADD_USER_PRESETS': {
      const { presets, added } = mergePresets(state.userPresets, action.presets);
      return added.length ? { ...state, userPresets: presets } : state;
    }

    case 'INST_UPDATE_USER_PRESET':
      return {
        ...state,
        userPresets: state.userPresets.map((p) => (p.id !== action.id ? p : {
          ...p,
          name: action.name?.trim() ? action.name.trim().slice(0, 60) : p.name,
          patch: action.patch ? cleanPatch({ ...p.patch, ...action.patch }) : p.patch,
        })),
      };

    case 'INST_DELETE_USER_PRESET':
      return {
        ...state,
        userPresets: state.userPresets.filter((p) => p.id !== action.id),
        favorites: state.favorites.filter((id) => id !== action.id),
        recents: state.recents.filter((id) => id !== action.id),
        category: state.category === 'MINE' && state.userPresets.length <= 1 ? 'ALL' : state.category,
      };

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
        const { assignments: _legacy, favorites, recents, userPresets, ...rest } = parsed;
        return {
          ...init, ...rest, search: '',
          favorites: parseIdList(favorites),
          recents: parseIdList(recents, 12),
          userPresets: Array.isArray(userPresets)
            ? userPresets.map(parseUserPreset).filter((p): p is UserPreset => !!p)
            : [],
        };
      }
    } catch (_) { /* corrupt or missing */ }
    return init;
  });

  // Debounced, and only for what is worth keeping (not the search box)
  const { isOpen, category, overrides, favorites, recents, userPresets } = state;
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({ isOpen, category, overrides, favorites, recents, userPresets }));
      } catch (_) { /* quota */ }
    }, 400);
    return () => clearTimeout(id);
  }, [isOpen, category, overrides, favorites, recents, userPresets]);

  // The user's sounds must be known to the engine before anything plays them
  // (live or in an export); set during render so the first schedule has them
  const pushed = useRef<UserPreset[] | null>(null);
  if (pushed.current !== userPresets) {
    getInstrumentEngine().setUserPresets(userPresets);
    pushed.current = userPresets;
  }
  useEffect(() => { getSequencerEngine().refreshMix(); }, [userPresets]);

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
