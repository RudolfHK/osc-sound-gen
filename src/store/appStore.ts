/**
 * State management: React Context + useReducer.
 * Chosen because the project has no third-party state library — zero extra deps.
 */

import { createContext, useContext, useReducer, type Dispatch } from 'react';
import type { OscillatorState, AdvancedSettings, OscillatorTab, AppState } from '../engine/oscillator';
import { DEFAULT_STATE, DEFAULT_ADVANCED } from '../engine/oscillator';
import { getTabColor } from '../utils/colors';
import { THEME_COLORS } from '../utils/math';
import {
  makeDefaultSequencerState,
  type SequencerNote,
  type SequencerTrack,
  type SequencerState,
  type SnapValue,
  type SequencerProject,
} from '../utils/music';

// ─── ID generator ─────────────────────────────────────────────────────────────

let _counter = 1;
function makeId(): string {
  return `tab-${Date.now()}-${_counter++}`;
}

const MAX_UNDO = 50;

// ─── Action types ─────────────────────────────────────────────────────────────

export type Action =
  // ── Tab actions ──────────────────────────────────────────────────────────────
  | { type: 'ADD_TAB' }
  | { type: 'REMOVE_TAB'; id: string }
  | { type: 'SET_ACTIVE_TAB'; id: string }
  | { type: 'SET_TAB_PLAYING'; id: string; playing: boolean }
  | { type: 'UPDATE_TAB_OSC'; id: string; oscillator: OscillatorState }
  | { type: 'UPDATE_TAB_ADVANCED'; id: string; advanced: AdvancedSettings }
  | { type: 'MUTE_TAB'; id: string; muted: boolean }
  | { type: 'SOLO_TAB'; id: string; solo: boolean }
  | { type: 'SET_TAB_LABEL'; id: string; label: string }
  | { type: 'SET_TAB_COLOR'; id: string; color: string }
  | { type: 'SET_MASTER_VOLUME'; volume: number }
  | { type: 'SET_RECORDING'; recording: boolean }
  | { type: 'SET_OVERLAY_MODE'; overlay: boolean }
  | { type: 'REORDER_TABS'; tabs: OscillatorTab[] }
  | { type: 'LOAD_SESSION'; appState: AppState }
  // ── Sequencer global ─────────────────────────────────────────────────────────
  | { type: 'SEQ_OPEN'; open: boolean }
  | { type: 'SEQ_SET_BPM'; bpm: number }
  | { type: 'SEQ_SET_BEATS_PER_BAR'; bpb: number }
  | { type: 'SEQ_SET_SNAP'; snap: SnapValue }
  | { type: 'SEQ_SET_LOOP'; enabled?: boolean; startBeat?: number; endBeat?: number }
  | { type: 'SEQ_SET_SONG_LENGTH'; bars: number }
  | { type: 'SEQ_SET_PLAYING'; playing: boolean }
  | { type: 'SEQ_SET_PLAYHEAD'; beat: number }
  | { type: 'SEQ_SET_EDIT_MODE'; mode: 'draw' | 'select' }
  | { type: 'SEQ_SET_VIEW'; startBeat?: number; lowNote?: number; highNote?: number }
  // ── Sequencer tracks ─────────────────────────────────────────────────────────
  | { type: 'SEQ_SYNC_TRACKS'; tabIds: string[] }
  | { type: 'SEQ_SET_TRACK_PAN'; tabId: string; pan: number }
  // ── Notes ────────────────────────────────────────────────────────────────────
  | { type: 'SEQ_ADD_NOTE'; tabId: string; note: SequencerNote }
  | { type: 'SEQ_REMOVE_NOTE'; tabId: string; noteId: string }
  | { type: 'SEQ_MOVE_NOTE'; tabId: string; noteId: string; startBeat: number; midiNote: number }
  | { type: 'SEQ_RESIZE_NOTE'; tabId: string; noteId: string; durationBeats: number }
  | { type: 'SEQ_SET_VELOCITY'; tabId: string; noteId: string; velocity: number }
  | { type: 'SEQ_CLEAR_TRACK'; tabId: string }
  | { type: 'SEQ_SELECT_NOTES'; ids: string[] }
  | { type: 'SEQ_DELETE_SELECTED' }
  // ── Undo/Redo ────────────────────────────────────────────────────────────────
  | { type: 'SEQ_PUSH_UNDO' }
  | { type: 'SEQ_UNDO' }
  | { type: 'SEQ_REDO' }
  // ── Project ──────────────────────────────────────────────────────────────────
  | { type: 'LOAD_PROJECT'; project: SequencerProject };

// ─── Initial state ────────────────────────────────────────────────────────────

const FIRST_TAB: OscillatorTab = {
  id: 'tab-1',
  label: 'OSC 1',
  color: getTabColor(0),
  oscillator: DEFAULT_STATE,
  advanced: DEFAULT_ADVANCED,
  isPlaying: false,
  isMuted: false,
  solo: false,
};

export const INITIAL_APP_STATE: AppState = {
  tabs: [FIRST_TAB],
  activeTabId: FIRST_TAB.id,
  masterVolume: 0.8,
  isRecording: false,
  overlayMode: false,
  sequencer: {
    ...makeDefaultSequencerState(),
    tracks: [{ tabId: FIRST_TAB.id, notes: [], pan: 0 }],
  },
};

// ─── Reducer ──────────────────────────────────────────────────────────────────

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {

    // ── Tab management ───────────────────────────────────────────────────────────

    case 'ADD_TAB': {
      const idx = state.tabs.length;
      const newTab: OscillatorTab = {
        id: makeId(),
        label: `OSC ${idx + 1}`,
        color: getTabColor(idx),
        oscillator: { ...DEFAULT_STATE, isPlaying: false },
        advanced: { ...DEFAULT_ADVANCED },
        isPlaying: false,
        isMuted: false,
        solo: false,
      };
      const newTrack: SequencerTrack = { tabId: newTab.id, notes: [], pan: 0 };
      return {
        ...state,
        tabs: [...state.tabs, newTab],
        activeTabId: newTab.id,
        sequencer: {
          ...state.sequencer,
          tracks: [...state.sequencer.tracks, newTrack],
        },
      };
    }

    case 'REMOVE_TAB': {
      if (state.tabs.length <= 1) return state;
      const idx = state.tabs.findIndex((t) => t.id === action.id);
      const newTabs = state.tabs.filter((t) => t.id !== action.id);
      const newActiveId =
        state.activeTabId === action.id
          ? (newTabs[Math.max(0, idx - 1)]?.id ?? newTabs[0].id)
          : state.activeTabId;
      return {
        ...state,
        tabs: newTabs,
        activeTabId: newActiveId,
        sequencer: {
          ...state.sequencer,
          tracks: state.sequencer.tracks.filter((t) => t.tabId !== action.id),
        },
      };
    }

    case 'SET_ACTIVE_TAB':
      return { ...state, activeTabId: action.id };

    case 'SET_TAB_PLAYING':
      return updateTab(state, action.id, (t) => ({ ...t, isPlaying: action.playing }));

    case 'UPDATE_TAB_OSC':
      return updateTab(state, action.id, (t) => ({ ...t, oscillator: action.oscillator }));

    case 'UPDATE_TAB_ADVANCED': {
      const newColor = THEME_COLORS[action.advanced.colorTheme];
      return updateTab(state, action.id, (t) => ({
        ...t,
        advanced: action.advanced,
        color: t.advanced.colorTheme !== action.advanced.colorTheme ? newColor : t.color,
      }));
    }

    case 'MUTE_TAB':
      return updateTab(state, action.id, (t) => ({ ...t, isMuted: action.muted }));

    case 'SOLO_TAB':
      return {
        ...state,
        tabs: state.tabs.map((t) => ({ ...t, solo: t.id === action.id ? action.solo : false })),
      };

    case 'SET_TAB_LABEL':
      return updateTab(state, action.id, (t) => ({ ...t, label: action.label }));

    case 'SET_TAB_COLOR':
      return updateTab(state, action.id, (t) => ({ ...t, color: action.color }));

    case 'SET_MASTER_VOLUME':
      return { ...state, masterVolume: action.volume };

    case 'SET_RECORDING':
      return { ...state, isRecording: action.recording };

    case 'SET_OVERLAY_MODE':
      return { ...state, overlayMode: action.overlay };

    case 'REORDER_TABS':
      return { ...state, tabs: action.tabs };

    case 'LOAD_SESSION':
      return action.appState;

    // ── Sequencer global ─────────────────────────────────────────────────────────

    case 'SEQ_OPEN':
      return seqUpdate(state, { isOpen: action.open });

    case 'SEQ_SET_BPM':
      return seqUpdate(state, { bpm: Math.max(20, Math.min(300, action.bpm)) });

    case 'SEQ_SET_BEATS_PER_BAR':
      return seqUpdate(state, { beatsPerBar: action.bpb });

    case 'SEQ_SET_SNAP':
      return seqUpdate(state, { snapValue: action.snap });

    case 'SEQ_SET_LOOP':
      return seqUpdate(state, {
        loopEnabled: action.enabled ?? state.sequencer.loopEnabled,
        loopStartBeat: action.startBeat ?? state.sequencer.loopStartBeat,
        loopEndBeat: action.endBeat ?? state.sequencer.loopEndBeat,
      });

    case 'SEQ_SET_SONG_LENGTH':
      return seqUpdate(state, { songLengthBars: action.bars });

    case 'SEQ_SET_PLAYING':
      return seqUpdate(state, { isPlaying: action.playing });

    case 'SEQ_SET_PLAYHEAD':
      return seqUpdate(state, { playheadBeat: action.beat });

    case 'SEQ_SET_EDIT_MODE':
      return seqUpdate(state, { editMode: action.mode });

    case 'SEQ_SET_VIEW':
      return seqUpdate(state, {
        viewStartBeat: action.startBeat ?? state.sequencer.viewStartBeat,
        viewLowNote: action.lowNote ?? state.sequencer.viewLowNote,
        viewHighNote: action.highNote ?? state.sequencer.viewHighNote,
      });

    // ── Tracks ────────────────────────────────────────────────────────────────────

    case 'SEQ_SYNC_TRACKS': {
      const existing = new Map(state.sequencer.tracks.map((t) => [t.tabId, t]));
      const synced = action.tabIds.map(
        (id) => existing.get(id) ?? { tabId: id, notes: [], pan: 0 },
      );
      return seqUpdate(state, { tracks: synced });
    }

    case 'SEQ_SET_TRACK_PAN':
      return seqUpdate(state, {
        tracks: state.sequencer.tracks.map((t) =>
          t.tabId === action.tabId ? { ...t, pan: action.pan } : t,
        ),
      });

    // ── Notes ─────────────────────────────────────────────────────────────────────

    case 'SEQ_ADD_NOTE':
      return seqUpdate(state, {
        tracks: state.sequencer.tracks.map((t) =>
          t.tabId === action.tabId ? { ...t, notes: [...t.notes, action.note] } : t,
        ),
      });

    case 'SEQ_REMOVE_NOTE':
      return seqUpdate(state, {
        tracks: state.sequencer.tracks.map((t) =>
          t.tabId === action.tabId
            ? { ...t, notes: t.notes.filter((n) => n.id !== action.noteId) }
            : t,
        ),
      });

    case 'SEQ_MOVE_NOTE':
      return seqUpdate(state, {
        tracks: state.sequencer.tracks.map((t) =>
          t.tabId === action.tabId
            ? {
                ...t,
                notes: t.notes.map((n) =>
                  n.id === action.noteId
                    ? { ...n, startBeat: action.startBeat, midiNote: action.midiNote }
                    : n,
                ),
              }
            : t,
        ),
      });

    case 'SEQ_RESIZE_NOTE':
      return seqUpdate(state, {
        tracks: state.sequencer.tracks.map((t) =>
          t.tabId === action.tabId
            ? {
                ...t,
                notes: t.notes.map((n) =>
                  n.id === action.noteId ? { ...n, durationBeats: action.durationBeats } : n,
                ),
              }
            : t,
        ),
      });

    case 'SEQ_SET_VELOCITY':
      return seqUpdate(state, {
        tracks: state.sequencer.tracks.map((t) =>
          t.tabId === action.tabId
            ? {
                ...t,
                notes: t.notes.map((n) =>
                  n.id === action.noteId ? { ...n, velocity: action.velocity } : n,
                ),
              }
            : t,
        ),
      });

    case 'SEQ_CLEAR_TRACK':
      return seqUpdate(state, {
        tracks: state.sequencer.tracks.map((t) =>
          t.tabId === action.tabId ? { ...t, notes: [] } : t,
        ),
      });

    case 'SEQ_SELECT_NOTES':
      return seqUpdate(state, { selectedNoteIds: action.ids });

    case 'SEQ_DELETE_SELECTED': {
      const sel = new Set(state.sequencer.selectedNoteIds);
      return seqUpdate(state, {
        tracks: state.sequencer.tracks.map((t) => ({
          ...t,
          notes: t.notes.filter((n) => !sel.has(n.id)),
        })),
        selectedNoteIds: [],
      });
    }

    // ── Undo / Redo ──────────────────────────────────────────────────────────────

    case 'SEQ_PUSH_UNDO': {
      const stack = [...state.sequencer.undoStack, state.sequencer.tracks].slice(-MAX_UNDO);
      return seqUpdate(state, { undoStack: stack, redoStack: [] });
    }

    case 'SEQ_UNDO': {
      if (state.sequencer.undoStack.length === 0) return state;
      const newStack = [...state.sequencer.undoStack];
      const prev = newStack.pop()!;
      return seqUpdate(state, {
        tracks: prev,
        undoStack: newStack,
        redoStack: [state.sequencer.tracks, ...state.sequencer.redoStack].slice(0, MAX_UNDO),
      });
    }

    case 'SEQ_REDO': {
      if (state.sequencer.redoStack.length === 0) return state;
      const [next, ...rest] = state.sequencer.redoStack;
      return seqUpdate(state, {
        tracks: next,
        undoStack: [...state.sequencer.undoStack, state.sequencer.tracks].slice(-MAX_UNDO),
        redoStack: rest,
      });
    }

    // ── Project ──────────────────────────────────────────────────────────────────

    case 'LOAD_PROJECT': {
      const p = action.project;
      return seqUpdate(state, {
        bpm: p.bpm,
        beatsPerBar: p.beatsPerBar,
        songLengthBars: p.songLengthBars,
        tracks: p.tracks,
      });
    }

    default:
      return state;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function updateTab(
  state: AppState,
  id: string,
  updater: (t: OscillatorTab) => OscillatorTab,
): AppState {
  return { ...state, tabs: state.tabs.map((t) => (t.id === id ? updater(t) : t)) };
}

function seqUpdate(state: AppState, patch: Partial<SequencerState>): AppState {
  return { ...state, sequencer: { ...state.sequencer, ...patch } };
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface StoreCtx {
  state: AppState;
  dispatch: Dispatch<Action>;
}

export const AppContext = createContext<StoreCtx | null>(null);

export function useAppStore(): StoreCtx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppStore must be used inside AppContext.Provider');
  return ctx;
}

export function useActiveTab() {
  const { state } = useAppStore();
  return state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0];
}

export function computeEffectiveMutes(tabs: OscillatorTab[]): Map<string, boolean> {
  const anySolo = tabs.some((t) => t.solo);
  const result = new Map<string, boolean>();
  for (const t of tabs) result.set(t.id, t.isMuted || (anySolo && !t.solo));
  return result;
}

export function useAppReducer(): StoreCtx {
  const [state, dispatch] = useReducer(reducer, INITIAL_APP_STATE);
  return { state, dispatch };
}
