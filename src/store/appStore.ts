/**
 * State management: React Context + useReducer.
 * Chosen because the project has no third-party state library — zero extra deps.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type Dispatch } from 'react';
import type { OscillatorState, AdvancedSettings, OscillatorTab, AppState, MainView } from '../engine/oscillator';
import { DEFAULT_STATE, DEFAULT_ADVANCED } from '../engine/oscillator';
import { getTabColor } from '../utils/colors';
import { THEME_COLORS, type ColorTheme } from '../utils/math';
import {
  makeDefaultSequencerState,
  makeTrack,
  makePattern,
  makeClip,
  normalizeTrack,
  uid,
  SNAP_BEATS,
  SECTION_COLORS,
  sectionsFromMarkers,
  type SequencerNote,
  type SequencerState,
  type SnapValue,
  type ArpSettings,
  type ChannelSettings,
  type AutomationTarget,
  type AutomationPoint,
  type AutomationLane,
  type Track,
  type TrackSource,
  type Clip,
  type Pattern,
  type Marker,
  type DocSnapshot,
  type InstrumentPatch,
  type SongSettings,
  type UndoEntry,
} from '../utils/music';
import { restoreParticipants, setUndoStepRequester, snapshotParticipants } from './history';
import { notify } from '../ui/notices';
import { accentFor, useTheme } from '../ui/theme';
import { makeLaneId, makePointId, withPoint } from '../engine/automation';
import {
  isLegacyTrackList, makeStarterDoc, migrateLegacySequencer,
  type LoadedProject, type LegacyTrack,
} from '../utils/project';

const MAX_UNDO = 60;

// ─── Action types ─────────────────────────────────────────────────────────────

type TrackPatch = Partial<Pick<Track,
  'name' | 'color' | 'muted' | 'solo' | 'pan' | 'showAutomation' | 'activeLaneId'>>;

export type Action =
  // ── App / oscillator lab ─────────────────────────────────────────────────────
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
  | { type: 'REORDER_TABS'; tabs: OscillatorTab[] }
  | { type: 'SET_MASTER_VOLUME'; volume: number }
  | { type: 'SET_RECORDING'; recording: boolean }
  | { type: 'SET_OVERLAY_MODE'; overlay: boolean }
  | { type: 'SET_VIEW'; view: MainView }
  | { type: 'SET_UI_THEME'; theme: ColorTheme }
  | { type: 'SET_PROJECT_NAME'; name: string }
  // ── Transport / global sequencer settings ────────────────────────────────────
  | { type: 'SEQ_SET_BPM'; bpm: number }
  | { type: 'SEQ_SET_BEATS_PER_BAR'; bpb: number }
  | { type: 'SEQ_SET_SNAP'; snap: SnapValue }
  | { type: 'SEQ_SET_ARRANGE_SNAP'; snap: SnapValue }
  | { type: 'SEQ_SET_LOOP'; enabled?: boolean; startBeat?: number; endBeat?: number }
  | { type: 'SEQ_SET_SONG_LENGTH'; bars: number }
  | { type: 'SEQ_SET_PLAYING'; playing: boolean }
  | { type: 'SEQ_SET_PLAYHEAD'; beat: number }
  | { type: 'SEQ_TOGGLE_METRONOME' }
  | { type: 'SEQ_SET_EDIT_MODE'; mode: 'draw' | 'select' }
  | { type: 'SEQ_SET_VIEW'; startBeat?: number; lowNote?: number; highNote?: number }
  | { type: 'SEQ_SET_ZOOM'; pxPerBeat: number }
  | { type: 'SEQ_SET_ARR_VIEW'; startBeat?: number; pxPerBeat?: number }
  | { type: 'SEQ_SET_DEFAULT_NOTE_LEN'; len: SnapValue }
  | { type: 'SEQ_TOGGLE_VELOCITY_LANE' }
  // ── Tracks ───────────────────────────────────────────────────────────────────
  | { type: 'TRACK_ADD'; source: TrackSource; name?: string }
  | { type: 'TRACK_REMOVE'; trackId: string }
  | { type: 'TRACK_DUPLICATE'; trackId: string }
  | { type: 'TRACK_MOVE'; trackId: string; toIndex: number }
  | { type: 'TRACK_UPDATE'; trackId: string; patch: TrackPatch }
  | { type: 'TRACK_SET_SOURCE'; trackId: string; source: TrackSource }
  | { type: 'TRACK_SELECT'; trackId: string | null }
  | { type: 'SEQ_SET_ARP'; trackId: string; arp: Partial<ArpSettings> }
  | { type: 'SEQ_SET_CHANNEL'; trackId: string; channel: Partial<ChannelSettings> }
  /** Edit a track's own instrument settings; `null` clears them back to the preset. */
  | { type: 'TRACK_SET_PATCH'; trackId: string; patch: InstrumentPatch | null }
  // ── Clips & patterns ─────────────────────────────────────────────────────────
  | { type: 'CLIP_ADD'; trackId: string; startBeat: number; lengthBeats: number; patternId?: string }
  | { type: 'CLIP_MOVE'; clipId: string; trackId: string; startBeat: number }
  | { type: 'CLIP_RESIZE'; clipId: string; startBeat: number; lengthBeats: number; offsetBeats: number }
  | { type: 'CLIP_DELETE'; clipId: string }
  /** `newId` lets a drag-to-copy gesture keep hold of the copy it creates. */
  | { type: 'CLIP_DUPLICATE'; clipId: string; linked?: boolean; newId?: string }
  | { type: 'CLIP_MAKE_UNIQUE'; clipId: string }
  | { type: 'CLIP_TOGGLE_MUTE'; clipId: string }
  | { type: 'CLIP_SPLIT'; clipId: string; atBeat: number }
  | { type: 'CLIP_SET_PATTERN'; clipId: string; patternId: string }
  | { type: 'CLIP_SELECT'; clipId: string | null }
  | { type: 'PATTERN_RENAME'; patternId: string; name: string }
  | { type: 'PATTERN_SET_LENGTH'; patternId: string; lengthBeats: number }
  // ── Notes (within a pattern) ─────────────────────────────────────────────────
  | { type: 'SEQ_ADD_NOTE'; patternId: string; note: SequencerNote }
  | { type: 'SEQ_REMOVE_NOTE'; patternId: string; noteId: string }
  | { type: 'SEQ_MOVE_NOTE'; patternId: string; noteId: string; startBeat: number; midiNote: number }
  | { type: 'SEQ_RESIZE_NOTE'; patternId: string; noteId: string; durationBeats: number }
  | { type: 'SEQ_SET_VELOCITY'; patternId: string; noteId: string; velocity: number }
  | { type: 'SEQ_CLEAR_PATTERN'; patternId: string }
  | { type: 'SEQ_SELECT_NOTES'; ids: string[] }
  | { type: 'SEQ_DELETE_SELECTED'; patternId: string }
  | { type: 'SEQ_COPY'; notes: SequencerNote[] }
  | { type: 'SEQ_PASTE'; patternId: string; atBeat: number }
  | { type: 'SEQ_QUANTIZE'; patternId: string }
  // ── Automation ───────────────────────────────────────────────────────────────
  | { type: 'SEQ_ADD_LANE'; trackId: string; target: AutomationTarget }
  | { type: 'SEQ_REMOVE_LANE'; trackId: string; laneId: string }
  | { type: 'SEQ_TOGGLE_LANE'; trackId: string; laneId: string }
  | { type: 'SEQ_ADD_POINT'; trackId: string; laneId: string; beat: number; value: number }
  | { type: 'SEQ_MOVE_POINT'; trackId: string; laneId: string; pointId: string; beat: number; value: number }
  | { type: 'SEQ_REMOVE_POINT'; trackId: string; laneId: string; pointId: string }
  | { type: 'SEQ_CLEAR_LANE'; trackId: string; laneId: string }
  // ── Sections (markers) ───────────────────────────────────────────────────────
  | { type: 'MARKER_ADD'; beat: number; name?: string }
  | { type: 'MARKER_UPDATE'; id: string; patch: Partial<Omit<Marker, 'id'>> }
  | { type: 'MARKER_REMOVE'; id: string }
  | { type: 'SECTION_DUPLICATE'; markerId: string }
  | { type: 'SECTION_DELETE'; markerId: string }
  // ── Undo/Redo ────────────────────────────────────────────────────────────────
  // `extras` (the other stores' undoable state) is filled in by the store's
  // dispatch; components dispatch these without it.
  | { type: 'SEQ_PUSH_UNDO'; extras?: Record<string, unknown>; label?: string }
  /** `steps` jumps several steps at once (the History list). */
  | { type: 'SEQ_UNDO'; extras?: Record<string, unknown>; steps?: number }
  | { type: 'SEQ_REDO'; extras?: Record<string, unknown>; steps?: number }
  /** Name the newest undo step after the edit that followed it. */
  | { type: 'SEQ_LABEL_UNDO'; label: string }
  // ── Project ──────────────────────────────────────────────────────────────────
  | { type: 'LOAD_PROJECT'; project: LoadedProject }
  | { type: 'NEW_PROJECT' };

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

export function makeInitialAppState(): AppState {
  const doc = makeStarterDoc();
  return {
    tabs: [FIRST_TAB],
    activeTabId: FIRST_TAB.id,
    masterVolume: 0.8,
    isRecording: false,
    overlayMode: false,
    view: 'arrange',
    uiTheme: 'green',
    projectName: 'Untitled',
    sequencer: {
      ...makeDefaultSequencerState(),
      ...doc,
      selectedTrackId: doc.tracks[0]?.id ?? null,
    },
  };
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function seqUpdate(state: AppState, patch: Partial<SequencerState>): AppState {
  return { ...state, sequencer: { ...state.sequencer, ...patch } };
}

function updateTab(state: AppState, id: string, updater: (t: OscillatorTab) => OscillatorTab): AppState {
  return { ...state, tabs: state.tabs.map((t) => (t.id === id ? updater(t) : t)) };
}

function patchTrack(state: AppState, trackId: string, fn: (t: Track) => Track): AppState {
  return seqUpdate(state, {
    tracks: state.sequencer.tracks.map((t) => (t.id === trackId ? fn(t) : t)),
  });
}

function patchLane(
  state: AppState, trackId: string, laneId: string,
  fn: (l: AutomationLane) => AutomationLane,
): AppState {
  return patchTrack(state, trackId, (t) => ({
    ...t, lanes: t.lanes.map((l) => (l.id === laneId ? fn(l) : l)),
  }));
}

function patchPattern(state: AppState, patternId: string, fn: (p: Pattern) => Pattern): AppState {
  const pat = state.sequencer.patterns[patternId];
  if (!pat) return state;
  return seqUpdate(state, { patterns: { ...state.sequencer.patterns, [patternId]: fn(pat) } });
}

function patchNotes(
  state: AppState, patternId: string,
  fn: (notes: SequencerNote[]) => SequencerNote[],
): AppState {
  return patchPattern(state, patternId, (p) => ({ ...p, notes: fn(p.notes) }));
}

export function findClip(seq: SequencerState, clipId: string | null): { track: Track; clip: Clip } | null {
  if (!clipId) return null;
  for (const track of seq.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

function patchClip(state: AppState, clipId: string, fn: (c: Clip, t: Track) => Clip): AppState {
  return seqUpdate(state, {
    tracks: state.sequencer.tracks.map((t) =>
      t.clips.some((c) => c.id === clipId)
        ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? fn(c, t) : c)) }
        : t),
  });
}

const isDrumTrack = (t: Track) => t.source.type === 'drums';

function docOf(seq: SequencerState): DocSnapshot {
  return { tracks: seq.tracks, patterns: seq.patterns, markers: seq.markers };
}

function songOf(seq: SequencerState): SongSettings {
  return {
    bpm: seq.bpm, beatsPerBar: seq.beatsPerBar, songLengthBars: seq.songLengthBars,
    loopEnabled: seq.loopEnabled, loopStartBeat: seq.loopStartBeat, loopEndBeat: seq.loopEndBeat,
  };
}

function entryOf(seq: SequencerState, extras: Record<string, unknown> = {}): UndoEntry {
  return { doc: docOf(seq), song: songOf(seq), extras };
}

/** Would recording `b` after `a` undo nothing? */
function sameEntry(a: UndoEntry, b: UndoEntry): boolean {
  if (a.doc.tracks !== b.doc.tracks || a.doc.patterns !== b.doc.patterns || a.doc.markers !== b.doc.markers) return false;
  for (const k of Object.keys(a.song) as (keyof SongSettings)[]) if (a.song[k] !== b.song[k]) return false;
  const keys = new Set([...Object.keys(a.extras), ...Object.keys(b.extras)]);
  for (const k of keys) if (a.extras[k] !== b.extras[k]) return false;
  return true;
}

let restoreId = 0;

/** Put an undo entry back: document and song settings here, the rest via an effect. */
function applyEntry(state: AppState, entry: UndoEntry, stacks: Pick<SequencerState, 'undoStack' | 'redoStack'>): AppState {
  const next = seqUpdate(state, {
    ...entry.doc,
    ...entry.song,
    ...stacks,
    pendingRestore: Object.keys(entry.extras).length ? { id: ++restoreId, extras: entry.extras } : null,
  });
  return seqUpdate(next, sanitizeSelection(next.sequencer));
}

/** After undo/redo or deletes, drop selections that point at nothing. */
function sanitizeSelection(seq: SequencerState): Partial<SequencerState> {
  const trackOk = seq.tracks.some((t) => t.id === seq.selectedTrackId);
  const clipOk = !!findClip(seq, seq.selectedClipId);
  return {
    selectedTrackId: trackOk ? seq.selectedTrackId : (seq.tracks[0]?.id ?? null),
    selectedClipId: clipOk ? seq.selectedClipId : null,
    selectedNoteIds: clipOk ? seq.selectedNoteIds : [],
  };
}

/** Grow the song so it always contains its content. */
function fitSongLength(state: AppState): AppState {
  const seq = state.sequencer;
  let end = 0;
  for (const t of seq.tracks) for (const c of t.clips) end = Math.max(end, c.startBeat + c.lengthBeats);
  for (const m of seq.markers) end = Math.max(end, m.beat + seq.beatsPerBar);
  const bars = Math.ceil(end / seq.beatsPerBar);
  return bars > seq.songLengthBars ? seqUpdate(state, { songLengthBars: bars }) : state;
}

/** Shift every clip, automation point and marker at/after `fromBeat` by `delta`. */
function shiftTimeline(seq: SequencerState, fromBeat: number, delta: number): Pick<SequencerState, 'tracks' | 'markers'> {
  return {
    tracks: seq.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => (c.startBeat >= fromBeat ? { ...c, startBeat: c.startBeat + delta } : c)),
      lanes: t.lanes.map((l) => ({
        ...l,
        points: l.points.map((p) => (p.beat >= fromBeat ? { ...p, beat: p.beat + delta } : p)),
      })),
    })),
    markers: seq.markers.map((m) => (m.beat >= fromBeat ? { ...m, beat: m.beat + delta } : m)),
  };
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

export function reducer(state: AppState, action: Action): AppState {
  const seq = state.sequencer;

  switch (action.type) {

    // ── Oscillator lab ──────────────────────────────────────────────────────────

    case 'ADD_TAB': {
      const idx = state.tabs.length;
      const newTab: OscillatorTab = {
        id: uid('tab'),
        label: `OSC ${idx + 1}`,
        color: getTabColor(idx),
        oscillator: { ...DEFAULT_STATE },
        advanced: { ...DEFAULT_ADVANCED },
        isPlaying: false,
        isMuted: false,
        solo: false,
      };
      return { ...state, tabs: [...state.tabs, newTab], activeTabId: newTab.id };
    }

    case 'REMOVE_TAB': {
      if (state.tabs.length <= 1) return state;
      const idx = state.tabs.findIndex((t) => t.id === action.id);
      const newTabs = state.tabs.filter((t) => t.id !== action.id);
      const newActiveId = state.activeTabId === action.id
        ? (newTabs[Math.max(0, idx - 1)]?.id ?? newTabs[0].id)
        : state.activeTabId;
      // Tracks that used this oscillator fall back to a preset rather than going silent
      const tracks = seq.tracks.map((t) =>
        t.source.type === 'oscillator' && t.source.tabId === action.id
          ? { ...t, source: { type: 'preset', presetId: 'keys-epiano' } as TrackSource }
          : t);
      return { ...state, tabs: newTabs, activeTabId: newActiveId, sequencer: { ...seq, tracks } };
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
      return { ...state, tabs: state.tabs.map((t) => ({ ...t, solo: t.id === action.id ? action.solo : false })) };

    case 'SET_TAB_LABEL':
      return updateTab(state, action.id, (t) => ({ ...t, label: action.label }));

    case 'SET_TAB_COLOR':
      return updateTab(state, action.id, (t) => ({ ...t, color: action.color }));

    case 'REORDER_TABS':
      return { ...state, tabs: action.tabs };

    case 'SET_MASTER_VOLUME':
      return { ...state, masterVolume: Math.max(0, Math.min(1, action.volume)) };

    case 'SET_RECORDING':
      return { ...state, isRecording: action.recording };

    case 'SET_OVERLAY_MODE':
      return { ...state, overlayMode: action.overlay };

    case 'SET_VIEW':
      return { ...state, view: action.view };

    case 'SET_UI_THEME':
      return { ...state, uiTheme: action.theme };

    case 'SET_PROJECT_NAME':
      return { ...state, projectName: action.name.trim() || 'Untitled' };

    // ── Transport ───────────────────────────────────────────────────────────────

    case 'SEQ_SET_BPM':
      return seqUpdate(state, { bpm: Math.max(20, Math.min(300, Math.round(action.bpm))) });

    case 'SEQ_SET_BEATS_PER_BAR':
      return seqUpdate(state, { beatsPerBar: Math.max(1, Math.min(16, action.bpb)) });

    case 'SEQ_SET_SNAP':
      return seqUpdate(state, { snapValue: action.snap });

    case 'SEQ_SET_ARRANGE_SNAP':
      return seqUpdate(state, { arrangeSnap: action.snap });

    case 'SEQ_SET_LOOP': {
      let start = Math.max(0, action.startBeat ?? seq.loopStartBeat);
      let end = Math.max(0, action.endBeat ?? seq.loopEndBeat);
      // A loop has to have length; swap if dragged backwards
      if (end < start) [start, end] = [end, start];
      if (end - start < 0.25) end = start + 0.25;
      return seqUpdate(state, {
        loopEnabled: action.enabled ?? seq.loopEnabled,
        loopStartBeat: start,
        loopEndBeat: end,
      });
    }

    case 'SEQ_SET_SONG_LENGTH':
      return seqUpdate(state, { songLengthBars: Math.max(1, Math.min(999, Math.round(action.bars))) });

    case 'SEQ_SET_PLAYING':
      return seqUpdate(state, { isPlaying: action.playing });

    case 'SEQ_SET_PLAYHEAD':
      return seqUpdate(state, { playheadBeat: Math.max(0, action.beat) });

    case 'SEQ_TOGGLE_METRONOME':
      return seqUpdate(state, { metronome: !seq.metronome });

    case 'SEQ_SET_EDIT_MODE':
      return seqUpdate(state, { editMode: action.mode });

    case 'SEQ_SET_VIEW':
      return seqUpdate(state, {
        viewStartBeat: Math.max(0, action.startBeat ?? seq.viewStartBeat),
        viewLowNote: action.lowNote ?? seq.viewLowNote,
        viewHighNote: action.highNote ?? seq.viewHighNote,
      });

    case 'SEQ_SET_ZOOM':
      return seqUpdate(state, { pxPerBeat: Math.max(20, Math.min(400, action.pxPerBeat)) });

    case 'SEQ_SET_ARR_VIEW':
      return seqUpdate(state, {
        arrStartBeat: Math.max(0, action.startBeat ?? seq.arrStartBeat),
        arrPxPerBeat: Math.max(3, Math.min(160, action.pxPerBeat ?? seq.arrPxPerBeat)),
      });

    case 'SEQ_SET_DEFAULT_NOTE_LEN':
      return seqUpdate(state, { defaultNoteLength: action.len });

    case 'SEQ_TOGGLE_VELOCITY_LANE':
      return seqUpdate(state, { showVelocityLane: !seq.showVelocityLane });

    // ── Tracks ──────────────────────────────────────────────────────────────────

    case 'TRACK_ADD': {
      const kindCount = seq.tracks.filter((t) => t.source.type === action.source.type).length;
      const defaultName = action.source.type === 'drums'
        ? (kindCount ? `Drums ${kindCount + 1}` : 'Drums')
        : action.source.type === 'oscillator'
          ? (state.tabs.find((t) => action.source.type === 'oscillator' && t.id === action.source.tabId)?.label ?? 'Oscillator')
          : `Track ${seq.tracks.length + 1}`;
      const track = makeTrack({ name: action.name ?? defaultName, source: action.source, index: seq.tracks.length });
      return seqUpdate(state, {
        tracks: [...seq.tracks, track],
        selectedTrackId: track.id,
        selectedClipId: null,
      });
    }

    case 'TRACK_REMOVE': {
      const idx = seq.tracks.findIndex((t) => t.id === action.trackId);
      if (idx < 0) return state;
      const tracks = seq.tracks.filter((t) => t.id !== action.trackId);
      const next = seqUpdate(state, { tracks });
      return seqUpdate(next, {
        ...sanitizeSelection(next.sequencer),
        selectedTrackId: tracks[Math.max(0, idx - 1)]?.id ?? null,
      });
    }

    case 'TRACK_DUPLICATE': {
      const idx = seq.tracks.findIndex((t) => t.id === action.trackId);
      if (idx < 0) return state;
      const src = seq.tracks[idx];
      // Duplicate patterns too, so editing the copy doesn't change the original
      const patterns = { ...seq.patterns };
      const clips = src.clips.map((c) => {
        if (isDrumTrack(src)) return { ...c, id: uid('clip') };
        const pat = seq.patterns[c.patternId];
        if (!pat) return { ...c, id: uid('clip') };
        const copy = { ...pat, id: uid('pat'), name: `${pat.name} copy`, notes: pat.notes.map((n) => ({ ...n })) };
        patterns[copy.id] = copy;
        return { ...c, id: uid('clip'), patternId: copy.id };
      });
      const dup: Track = {
        ...src, id: uid('trk'), name: `${src.name} copy`, clips, solo: false,
        lanes: src.lanes.map((l) => ({ ...l, id: makeLaneId(), points: l.points.map((p) => ({ ...p, id: makePointId() })) })),
        activeLaneId: null,
      };
      const tracks = [...seq.tracks];
      tracks.splice(idx + 1, 0, dup);
      return seqUpdate(state, { tracks, patterns, selectedTrackId: dup.id });
    }

    case 'TRACK_MOVE': {
      const from = seq.tracks.findIndex((t) => t.id === action.trackId);
      if (from < 0) return state;
      const tracks = [...seq.tracks];
      const [moved] = tracks.splice(from, 1);
      tracks.splice(Math.max(0, Math.min(tracks.length, action.toIndex)), 0, moved);
      return seqUpdate(state, { tracks });
    }

    case 'TRACK_UPDATE':
      return patchTrack(state, action.trackId, (t) => ({ ...t, ...action.patch }));

    case 'TRACK_SET_SOURCE':
      return patchTrack(state, action.trackId, (t) => {
        // Drum clips point at drum patterns and note clips at note patterns, so a
        // track can't keep its clips across that boundary.
        const crossesKind = isDrumTrack(t) !== (action.source.type === 'drums');
        // A patch tweaks one particular preset; a new sound starts clean
        const samePreset = t.source.type === 'preset' && action.source.type === 'preset'
          && t.source.presetId === action.source.presetId;
        return { ...t, source: action.source, clips: crossesKind ? [] : t.clips, patch: samePreset ? t.patch : {} };
      });

    case 'TRACK_SET_PATCH':
      return patchTrack(state, action.trackId, (t) => ({
        ...t,
        patch: action.patch === null ? {} : { ...t.patch, ...action.patch },
      }));

    case 'TRACK_SELECT':
      return seqUpdate(state, { selectedTrackId: action.trackId });

    case 'SEQ_SET_ARP':
      return patchTrack(state, action.trackId, (t) => ({ ...t, arp: { ...t.arp, ...action.arp } }));

    case 'SEQ_SET_CHANNEL':
      return patchTrack(state, action.trackId, (t) => ({ ...t, channel: { ...t.channel, ...action.channel } }));

    // ── Clips ───────────────────────────────────────────────────────────────────

    case 'CLIP_ADD': {
      const track = seq.tracks.find((t) => t.id === action.trackId);
      if (!track) return state;
      const length = Math.max(0.25, action.lengthBeats);
      let patternId = action.patternId;
      let patterns = seq.patterns;
      if (!patternId) {
        if (isDrumTrack(track)) return state; // drum clips must name a drum pattern
        const n = Object.values(seq.patterns).filter((p) => p.name.startsWith(track.name)).length;
        const pat = makePattern(`${track.name} ${n + 1}`, length);
        patterns = { ...seq.patterns, [pat.id]: pat };
        patternId = pat.id;
      }
      const clip = makeClip(patternId, Math.max(0, action.startBeat), length);
      const next = seqUpdate(state, {
        patterns,
        tracks: seq.tracks.map((t) => (t.id === track.id ? { ...t, clips: [...t.clips, clip] } : t)),
        selectedTrackId: track.id,
        selectedClipId: clip.id,
        selectedNoteIds: [],
      });
      return fitSongLength(next);
    }

    case 'CLIP_MOVE': {
      const found = findClip(seq, action.clipId);
      const dest = seq.tracks.find((t) => t.id === action.trackId);
      if (!found || !dest) return state;
      // Clips only move between tracks of the same kind
      const destId = isDrumTrack(dest) === isDrumTrack(found.track) ? dest.id : found.track.id;
      const moved = { ...found.clip, startBeat: Math.max(0, action.startBeat) };
      const next = seqUpdate(state, {
        tracks: seq.tracks.map((t) => {
          let clips = t.clips;
          if (t.id === found.track.id) clips = clips.filter((c) => c.id !== moved.id);
          if (t.id === destId) clips = [...clips, moved];
          return clips === t.clips ? t : { ...t, clips };
        }),
        selectedTrackId: destId,
      });
      return fitSongLength(next);
    }

    case 'CLIP_RESIZE':
      return fitSongLength(patchClip(state, action.clipId, (c) => ({
        ...c,
        startBeat: Math.max(0, action.startBeat),
        lengthBeats: Math.max(0.25, action.lengthBeats),
        offsetBeats: Math.max(0, action.offsetBeats),
      })));

    case 'CLIP_DELETE': {
      const next = seqUpdate(state, {
        tracks: seq.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== action.clipId) })),
      });
      return seqUpdate(next, sanitizeSelection(next.sequencer));
    }

    case 'CLIP_DUPLICATE': {
      const found = findClip(seq, action.clipId);
      if (!found) return state;
      const { track, clip } = found;
      let patternId = clip.patternId;
      let patterns = seq.patterns;
      if (!action.linked && !isDrumTrack(track)) {
        const pat = seq.patterns[clip.patternId];
        if (pat) {
          const copy = { ...pat, id: uid('pat'), name: nextName(pat.name, seq.patterns), notes: pat.notes.map((n) => ({ ...n })) };
          patterns = { ...patterns, [copy.id]: copy };
          patternId = copy.id;
        }
      }
      const dup: Clip = { ...clip, id: action.newId ?? uid('clip'), patternId, startBeat: clip.startBeat + clip.lengthBeats };
      const next = seqUpdate(state, {
        patterns,
        tracks: seq.tracks.map((t) => (t.id === track.id ? { ...t, clips: [...t.clips, dup] } : t)),
        selectedClipId: dup.id,
        selectedNoteIds: [],
      });
      return fitSongLength(next);
    }

    case 'CLIP_MAKE_UNIQUE': {
      const found = findClip(seq, action.clipId);
      if (!found || isDrumTrack(found.track)) return state;
      const pat = seq.patterns[found.clip.patternId];
      if (!pat) return state;
      const copy = { ...pat, id: uid('pat'), name: nextName(pat.name, seq.patterns), notes: pat.notes.map((n) => ({ ...n })) };
      const next = seqUpdate(state, { patterns: { ...seq.patterns, [copy.id]: copy } });
      return patchClip(next, action.clipId, (c) => ({ ...c, patternId: copy.id }));
    }

    case 'CLIP_TOGGLE_MUTE':
      return patchClip(state, action.clipId, (c) => ({ ...c, muted: !c.muted }));

    case 'CLIP_SPLIT': {
      const found = findClip(seq, action.clipId);
      if (!found) return state;
      const { track, clip } = found;
      const cut = action.atBeat - clip.startBeat;
      if (cut <= 0.0625 || cut >= clip.lengthBeats - 0.0625) return state;
      const left: Clip = { ...clip, lengthBeats: cut };
      const right: Clip = {
        ...clip, id: uid('clip'),
        startBeat: action.atBeat,
        lengthBeats: clip.lengthBeats - cut,
        offsetBeats: clip.offsetBeats + cut,
      };
      return seqUpdate(state, {
        tracks: seq.tracks.map((t) => (t.id === track.id
          ? { ...t, clips: t.clips.flatMap((c) => (c.id === clip.id ? [left, right] : [c])) }
          : t)),
        selectedClipId: right.id,
      });
    }

    case 'CLIP_SET_PATTERN':
      return patchClip(state, action.clipId, (c) => ({ ...c, patternId: action.patternId }));

    case 'CLIP_SELECT': {
      const found = findClip(seq, action.clipId);
      return seqUpdate(state, {
        selectedClipId: action.clipId,
        selectedTrackId: found?.track.id ?? seq.selectedTrackId,
        selectedNoteIds: [],
        // Jump the piano roll to the start of the pattern
        viewStartBeat: action.clipId !== seq.selectedClipId ? 0 : seq.viewStartBeat,
      });
    }

    case 'PATTERN_RENAME':
      return patchPattern(state, action.patternId, (p) => ({ ...p, name: action.name.trim() || p.name }));

    case 'PATTERN_SET_LENGTH':
      return patchPattern(state, action.patternId, (p) => ({
        ...p, lengthBeats: Math.max(0.25, Math.min(512, action.lengthBeats)),
      }));

    // ── Notes ───────────────────────────────────────────────────────────────────

    case 'SEQ_ADD_NOTE': {
      const next = patchNotes(state, action.patternId, (ns) => [...ns, action.note]);
      // Drawing past the loop end grows the pattern to the next bar
      return patchPattern(next, action.patternId, (p) => {
        const end = action.note.startBeat + action.note.durationBeats;
        if (end <= p.lengthBeats) return p;
        const bar = seq.beatsPerBar;
        return { ...p, lengthBeats: Math.ceil(end / bar) * bar };
      });
    }

    case 'SEQ_REMOVE_NOTE':
      return patchNotes(state, action.patternId, (ns) => ns.filter((n) => n.id !== action.noteId));

    case 'SEQ_MOVE_NOTE':
      return patchNotes(state, action.patternId, (ns) => ns.map((n) => (n.id === action.noteId
        ? { ...n, startBeat: Math.max(0, action.startBeat), midiNote: Math.max(0, Math.min(127, action.midiNote)) }
        : n)));

    case 'SEQ_RESIZE_NOTE':
      return patchNotes(state, action.patternId, (ns) => ns.map((n) => (n.id === action.noteId
        ? { ...n, durationBeats: Math.max(0.0625, action.durationBeats) }
        : n)));

    case 'SEQ_SET_VELOCITY':
      return patchNotes(state, action.patternId, (ns) => ns.map((n) => (n.id === action.noteId
        ? { ...n, velocity: Math.max(1, Math.min(127, Math.round(action.velocity))) }
        : n)));

    case 'SEQ_CLEAR_PATTERN':
      return seqUpdate(patchNotes(state, action.patternId, () => []), { selectedNoteIds: [] });

    case 'SEQ_SELECT_NOTES':
      return seqUpdate(state, { selectedNoteIds: action.ids });

    case 'SEQ_DELETE_SELECTED': {
      const sel = new Set(seq.selectedNoteIds);
      return seqUpdate(
        patchNotes(state, action.patternId, (ns) => ns.filter((n) => !sel.has(n.id))),
        { selectedNoteIds: [] },
      );
    }

    case 'SEQ_COPY':
      return seqUpdate(state, { copiedNotes: action.notes });

    case 'SEQ_PASTE': {
      const copied = seq.copiedNotes;
      if (!copied?.length) return state;
      const minBeat = Math.min(...copied.map((n) => n.startBeat));
      const offset = action.atBeat - minBeat;
      const newNotes = copied.map((n) => ({
        ...n, id: uid('n'), startBeat: Math.max(0, n.startBeat + offset),
      }));
      return seqUpdate(
        patchNotes(state, action.patternId, (ns) => [...ns, ...newNotes]),
        { selectedNoteIds: newNotes.map((n) => n.id) },
      );
    }

    case 'SEQ_QUANTIZE': {
      if (seq.selectedNoteIds.length === 0) return state;
      const grid = SNAP_BEATS[seq.snapValue];
      const sel = new Set(seq.selectedNoteIds);
      return patchNotes(state, action.patternId, (ns) => ns.map((n) => (sel.has(n.id)
        ? { ...n, startBeat: Math.round(n.startBeat / grid) * grid }
        : n)));
    }

    // ── Automation ──────────────────────────────────────────────────────────────

    case 'SEQ_ADD_LANE': {
      const track = seq.tracks.find((t) => t.id === action.trackId);
      if (!track) return state;
      const existing = track.lanes.find((l) => l.target === action.target);
      // One lane per parameter — adding an existing target just selects it
      if (existing) {
        return patchTrack(state, track.id, (t) => ({ ...t, activeLaneId: existing.id, showAutomation: true }));
      }
      const lane: AutomationLane = { id: makeLaneId(), target: action.target, enabled: true, points: [] };
      return patchTrack(state, track.id, (t) => ({
        ...t, lanes: [...t.lanes, lane], activeLaneId: lane.id, showAutomation: true,
      }));
    }

    case 'SEQ_REMOVE_LANE':
      return patchTrack(state, action.trackId, (t) => {
        const lanes = t.lanes.filter((l) => l.id !== action.laneId);
        return {
          ...t, lanes,
          activeLaneId: t.activeLaneId === action.laneId ? (lanes[0]?.id ?? null) : t.activeLaneId,
        };
      });

    case 'SEQ_TOGGLE_LANE':
      return patchLane(state, action.trackId, action.laneId, (l) => ({ ...l, enabled: !l.enabled }));

    case 'SEQ_ADD_POINT': {
      const point: AutomationPoint = {
        id: makePointId(),
        beat: Math.max(0, action.beat),
        value: Math.max(0, Math.min(1, action.value)),
      };
      return patchLane(state, action.trackId, action.laneId, (l) => ({ ...l, points: withPoint(l.points, point) }));
    }

    case 'SEQ_MOVE_POINT':
      return patchLane(state, action.trackId, action.laneId, (l) => ({
        ...l,
        points: l.points
          .map((p) => (p.id === action.pointId
            ? { ...p, beat: Math.max(0, action.beat), value: Math.max(0, Math.min(1, action.value)) }
            : p))
          .sort((a, b) => a.beat - b.beat),
      }));

    case 'SEQ_REMOVE_POINT':
      return patchLane(state, action.trackId, action.laneId, (l) => ({
        ...l, points: l.points.filter((p) => p.id !== action.pointId),
      }));

    case 'SEQ_CLEAR_LANE':
      return patchLane(state, action.trackId, action.laneId, (l) => ({ ...l, points: [] }));

    // ── Sections ────────────────────────────────────────────────────────────────

    case 'MARKER_ADD': {
      const beat = Math.max(0, action.beat);
      // One marker per position
      if (seq.markers.some((m) => Math.abs(m.beat - beat) < 1e-6)) return state;
      const marker: Marker = {
        id: uid('mk'),
        beat,
        name: action.name ?? defaultSectionName(seq.markers.length),
        color: SECTION_COLORS[seq.markers.length % SECTION_COLORS.length],
      };
      return fitSongLength(seqUpdate(state, {
        markers: [...seq.markers, marker].sort((a, b) => a.beat - b.beat),
      }));
    }

    case 'MARKER_UPDATE':
      return seqUpdate(state, {
        markers: seq.markers
          .map((m) => (m.id === action.id
            ? { ...m, ...action.patch, beat: Math.max(0, action.patch.beat ?? m.beat) }
            : m))
          .sort((a, b) => a.beat - b.beat),
      });

    case 'MARKER_REMOVE':
      return seqUpdate(state, { markers: seq.markers.filter((m) => m.id !== action.id) });

    case 'SECTION_DUPLICATE': {
      const sections = sectionsFromMarkers(seq.markers, seq.songLengthBars * seq.beatsPerBar);
      const sec = sections.find((s) => s.id === action.markerId);
      if (!sec) return state;
      const len = sec.endBeat - sec.beat;
      if (len <= 0) return state;

      // Open a gap the length of the section right after it…
      const shifted = shiftTimeline(seq, sec.endBeat, len);
      // …then copy the section's clips and automation into that gap.
      const patterns = { ...seq.patterns };
      const tracks = shifted.tracks.map((t, ti) => {
        const orig = seq.tracks[ti];
        const copies = orig.clips
          .filter((c) => c.startBeat >= sec.beat && c.startBeat < sec.endBeat)
          .map((c) => {
            let patternId = c.patternId;
            if (!isDrumTrack(orig)) {
              const pat = seq.patterns[c.patternId];
              if (pat) {
                const copy = { ...pat, id: uid('pat'), name: nextName(pat.name, patterns), notes: pat.notes.map((n) => ({ ...n })) };
                patterns[copy.id] = copy;
                patternId = copy.id;
              }
            }
            return { ...c, id: uid('clip'), patternId, startBeat: c.startBeat + len };
          });
        const lanes = t.lanes.map((l, li) => {
          const src = orig.lanes[li];
          const pts = src.points
            .filter((p) => p.beat >= sec.beat && p.beat < sec.endBeat)
            .map((p) => ({ ...p, id: makePointId(), beat: p.beat + len }));
          return pts.length ? { ...l, points: [...l.points, ...pts].sort((a, b) => a.beat - b.beat) } : l;
        });
        return { ...t, clips: [...t.clips, ...copies], lanes };
      });
      const copyMarker: Marker = { ...sec, id: uid('mk'), beat: sec.endBeat, name: nextName(sec.name, {}) };
      const next = seqUpdate(state, {
        tracks,
        patterns,
        markers: [...shifted.markers, { id: copyMarker.id, beat: copyMarker.beat, name: copyMarker.name, color: copyMarker.color }]
          .sort((a, b) => a.beat - b.beat),
        songLengthBars: seq.songLengthBars + Math.ceil(len / seq.beatsPerBar),
      });
      return next;
    }

    case 'SECTION_DELETE': {
      const sections = sectionsFromMarkers(seq.markers, seq.songLengthBars * seq.beatsPerBar);
      const sec = sections.find((s) => s.id === action.markerId);
      if (!sec) return state;
      const len = sec.endBeat - sec.beat;
      // Remove content that starts inside the section, then close the gap
      const pruned: SequencerState = {
        ...seq,
        tracks: seq.tracks.map((t) => ({
          ...t,
          clips: t.clips.filter((c) => !(c.startBeat >= sec.beat && c.startBeat < sec.endBeat)),
          lanes: t.lanes.map((l) => ({
            ...l, points: l.points.filter((p) => !(p.beat >= sec.beat && p.beat < sec.endBeat)),
          })),
        })),
        markers: seq.markers.filter((m) => m.id !== sec.id),
      };
      const shifted = len > 0 ? shiftTimeline(pruned, sec.endBeat, -len) : pruned;
      const next = seqUpdate(state, {
        tracks: shifted.tracks,
        markers: shifted.markers,
        songLengthBars: Math.max(1, seq.songLengthBars - Math.floor(len / seq.beatsPerBar)),
      });
      return seqUpdate(next, sanitizeSelection(next.sequencer));
    }

    // ── Undo / Redo ─────────────────────────────────────────────────────────────

    case 'SEQ_PUSH_UNDO': {
      const entry = { ...entryOf(seq, action.extras), label: action.label };
      const top = seq.undoStack[seq.undoStack.length - 1];
      // A click that changed nothing shouldn't cost an undo step (but may name one)
      if (top && sameEntry(top, entry)) {
        return !top.label && action.label
          ? seqUpdate(state, { undoStack: [...seq.undoStack.slice(0, -1), { ...top, label: action.label }] })
          : state;
      }
      return seqUpdate(state, { undoStack: [...seq.undoStack, entry].slice(-MAX_UNDO), redoStack: [] });
    }

    case 'SEQ_LABEL_UNDO': {
      const top = seq.undoStack[seq.undoStack.length - 1];
      if (!top || top.label) return state;
      return seqUpdate(state, { undoStack: [...seq.undoStack.slice(0, -1), { ...top, label: action.label }] });
    }

    case 'SEQ_UNDO': {
      // Undoing n edits: go back to the state before the oldest of them. Each
      // undone edit's "after" state moves to the redo stack under its name.
      const n = Math.min(Math.max(1, action.steps ?? 1), seq.undoStack.length);
      if (n === 0) return state;
      const keep = seq.undoStack.slice(0, seq.undoStack.length - n);
      const undone = seq.undoStack.slice(seq.undoStack.length - n);
      const after = [...undone.slice(1), entryOf(seq, action.extras)];
      const redo = after.map((e, i) => ({ ...e, label: undone[i].label }));
      return applyEntry(state, undone[0], {
        undoStack: keep,
        redoStack: [...redo, ...seq.redoStack].slice(0, MAX_UNDO),
      });
    }

    case 'SEQ_REDO': {
      const n = Math.min(Math.max(1, action.steps ?? 1), seq.redoStack.length);
      if (n === 0) return state;
      const redone = seq.redoStack.slice(0, n);
      const before = [entryOf(seq, action.extras), ...redone.slice(0, n - 1)];
      const undo = before.map((e, i) => ({ ...e, label: redone[i].label }));
      return applyEntry(state, redone[n - 1], {
        undoStack: [...seq.undoStack, ...undo].slice(-MAX_UNDO),
        redoStack: seq.redoStack.slice(n),
      });
    }

    // ── Project ─────────────────────────────────────────────────────────────────

    case 'LOAD_PROJECT': {
      const p = action.project;
      // Oscillator tabs carried by the project join the lab
      const known = new Set(state.tabs.map((t) => t.id));
      const tabs = [...state.tabs, ...p.oscillators.filter((t) => !known.has(t.id)).map((t) => ({ ...t, isPlaying: false }))];
      return {
        ...state,
        tabs,
        projectName: p.name,
        masterVolume: p.masterVolume,
        sequencer: {
          ...seq,
          ...p.doc,
          bpm: p.bpm,
          beatsPerBar: p.beatsPerBar,
          songLengthBars: p.songLengthBars,
          loopEnabled: p.loop.enabled,
          loopStartBeat: p.loop.startBeat,
          loopEndBeat: p.loop.endBeat,
          isPlaying: false,
          playheadBeat: 0,
          selectedTrackId: p.doc.tracks[0]?.id ?? null,
          selectedClipId: null,
          selectedNoteIds: [],
          arrStartBeat: 0,
          undoStack: [],
          redoStack: [],
          pendingRestore: null,
        },
      };
    }

    case 'NEW_PROJECT': {
      const fresh = makeInitialAppState();
      return {
        ...state,
        projectName: 'Untitled',
        sequencer: {
          ...fresh.sequencer,
          bpm: seq.bpm,
          arrPxPerBeat: seq.arrPxPerBeat,
          pxPerBeat: seq.pxPerBeat,
        },
      };
    }

    default:
      return state;
  }
}

function defaultSectionName(i: number): string {
  return ['Intro', 'Verse', 'Build', 'Drop', 'Break', 'Chorus', 'Bridge', 'Outro'][i % 8];
}

/** "Bass 1" → "Bass 2", picking the next unused number. */
function nextName(name: string, patterns: Record<string, Pattern>): string {
  const m = name.match(/^(.*?)(\s*)(\d+)$/);
  const base = m ? m[1] : name;
  const taken = new Set(Object.values(patterns).map((p) => p.name));
  let n = m ? parseInt(m[3], 10) + 1 : 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
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

/** The UI accent colour. */
export function useAccent(): string {
  const { state } = useAppStore();
  const theme = useTheme();
  return accentFor(THEME_COLORS[state.uiTheme] ?? THEME_COLORS.green, theme);
}

export function computeEffectiveMutes(tabs: OscillatorTab[]): Map<string, boolean> {
  const anySolo = tabs.some((t) => t.solo);
  const result = new Map<string, boolean>();
  for (const t of tabs) result.set(t.id, t.isMuted || (anySolo && !t.solo));
  return result;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

const LS_KEY = 'osc-app-state';
const LS_INSTRUMENTS = 'osc-instrument-state';
const SCHEMA = 2;
/** Writes are coalesced: one JSON.stringify per burst of edits, not per action. */
const PERSIST_DEBOUNCE_MS = 400;

/** Note patterns some clip still plays. The rest are orphans left by deletes. */
export function referencedPatterns(seq: Pick<SequencerState, 'tracks' | 'patterns'>): Record<string, Pattern> {
  const used = new Set<string>();
  for (const t of seq.tracks) if (t.source.type !== 'drums') for (const c of t.clips) used.add(c.patternId);
  const out: Record<string, Pattern> = {};
  for (const [id, p] of Object.entries(seq.patterns)) if (used.has(id)) out[id] = p;
  return out;
}

/**
 * Strip runtime-only and bulky fields before writing. Orphaned note patterns
 * are dropped here — they stay in memory while undo might still need them,
 * but they no longer accumulate in storage.
 */
function persistable(state: AppState) {
  const { undoStack: _u, redoStack: _r, copiedNotes: _c, isPlaying: _p, pendingRestore: _pr, ...seq } = state.sequencer;
  return {
    schema: SCHEMA,
    ...state,
    isRecording: false,
    tabs: state.tabs.map((t) => ({ ...t, isPlaying: false })),
    sequencer: { ...seq, patterns: referencedPatterns(seq) },
  };
}

/** Write the session; tell the user (once) if storage is full rather than failing silently. */
let warnedQuota = false;
function writeSession(state: AppState): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(persistable(state)));
    warnedQuota = false;
  } catch {
    if (!warnedQuota) {
      warnedQuota = true;
      notify('Browser storage is full — this session is no longer being saved. Use OSC ▾ → Save to keep your work.', 'error');
    }
  }
}

/**
 * Rebuild app state from whatever is in localStorage — current schema, or a
 * session saved by an older release. Exported for tests.
 */
export function restoreState(raw: string | null, legacyAssignmentsRaw: string | null): AppState {
  const init = makeInitialAppState();
  if (!raw) return init;

  const parsed = JSON.parse(raw) as Partial<AppState> & { schema?: number };
  const tabs = (parsed.tabs?.length ? parsed.tabs : init.tabs).map((t) => ({ ...t, isPlaying: false }));
  const savedSeq = (parsed.sequencer ?? {}) as Partial<SequencerState> & { tracks?: unknown };
  const base = makeDefaultSequencerState();

  let doc: DocSnapshot;
  if (isLegacyTrackList(savedSeq.tracks)) {
    // Pre-v2 session: tracks were bound to oscillator tabs, and instrument
    // choices lived in the instrument library's own storage.
    let assignments: Record<string, string> = {};
    try {
      assignments = (JSON.parse(legacyAssignmentsRaw ?? '{}') as { assignments?: Record<string, string> }).assignments ?? {};
    } catch { /* ignore */ }
    const bpb = savedSeq.beatsPerBar ?? 4;
    doc = migrateLegacySequencer(
      savedSeq.tracks as LegacyTrack[], tabs, assignments,
      (savedSeq.songLengthBars ?? 8) * bpb, bpb,
    );
  } else if (Array.isArray(savedSeq.tracks)) {
    const patterns = (savedSeq.patterns ?? {}) as Record<string, Pattern>;
    doc = {
      tracks: (savedSeq.tracks as Track[]).map((t, i) => {
        const track = normalizeTrack(t, i);
        // Note clips must point at a pattern that exists
        track.clips = track.clips.filter((c) => track.source.type === 'drums' || !!patterns[c.patternId]);
        return track;
      }),
      patterns,
      markers: (savedSeq.markers ?? []) as Marker[],
    };
  } else {
    return init;
  }

  const restoredSeq: SequencerState = {
    ...base,
    ...(savedSeq as Partial<SequencerState>),
    ...doc,
    isPlaying: false,
    undoStack: [],
    redoStack: [],
    pendingRestore: null,
    copiedNotes: null,
  };

  return {
    ...init,
    ...parsed,
    tabs,
    activeTabId: tabs.some((t) => t.id === parsed.activeTabId) ? parsed.activeTabId! : tabs[0].id,
    isRecording: false,
    view: parsed.view === 'lab' ? 'lab' : 'arrange',
    uiTheme: parsed.uiTheme ?? 'green',
    projectName: parsed.projectName ?? 'Untitled',
    sequencer: { ...restoredSeq, ...sanitizeSelection(restoredSeq) },
  };
}

// ─── Automatic undo steps ─────────────────────────────────────────────────────

/** Track fields that are view state, not part of the song — no undo step. */
const VIEW_ONLY_TRACK_FIELDS = new Set(['activeLaneId', 'showAutomation']);

/** Merge repeated moves of the same control into one undo step within this gap. */
export const UNDO_COALESCE_MS = 1200;

/**
 * Which edits record an undo step on their own, so every control in the app
 * is undoable without each one remembering to push a snapshot.
 *
 * Returns a key: repeated actions with the same key in quick succession — a
 * fader being dragged, a knob being turned — share one undo step, the way a
 * DAW treats a single gesture. `null` means "always a new step"; `undefined`
 * means the action doesn't edit the song (or pushes its own step).
 */
export function autoUndoKey(action: Action): string | null | undefined {
  const keys = (o: object) => Object.keys(o).sort().join(',');
  switch (action.type) {
    case 'TRACK_UPDATE': {
      const fields = Object.keys(action.patch).filter((k) => !VIEW_ONLY_TRACK_FIELDS.has(k));
      if (fields.length === 0) return undefined;
      // Mute/solo are toggles: each click is its own step
      if (fields.includes('muted') || fields.includes('solo')) return null;
      return `track:${action.trackId}:${fields.sort().join(',')}`;
    }
    case 'SEQ_SET_CHANNEL': return `channel:${action.trackId}:${keys(action.channel)}`;
    case 'SEQ_SET_ARP': return `arp:${action.trackId}:${keys(action.arp)}`;
    case 'MARKER_UPDATE': return `marker:${action.id}:${keys(action.patch)}`;
    case 'TRACK_SET_PATCH': return action.patch === null ? null : `patch:${action.trackId}:${keys(action.patch)}`;
    case 'SEQ_SET_BPM': return 'bpm';
    case 'SEQ_SET_SONG_LENGTH': return 'song-length';
    case 'SEQ_SET_LOOP': return 'loop';
    case 'SEQ_SET_BEATS_PER_BAR': return null;
    case 'PATTERN_RENAME': return `pattern-name:${action.patternId}`;
    case 'TRACK_ADD':
    case 'TRACK_REMOVE':
    case 'TRACK_DUPLICATE':
    case 'TRACK_MOVE':
    case 'TRACK_SET_SOURCE':
    case 'MARKER_ADD':
    case 'MARKER_REMOVE':
    case 'SECTION_DUPLICATE':
    case 'SECTION_DELETE':
    case 'CLIP_TOGGLE_MUTE':
    case 'SEQ_ADD_LANE':
    case 'SEQ_REMOVE_LANE':
    case 'SEQ_TOGGLE_LANE':
    case 'SEQ_CLEAR_LANE':
      return null;
    default:
      return undefined;
  }
}

const UNDO_LABELS: Partial<Record<Action['type'], string>> = {
  MARKER_UPDATE: 'Edit section',
  SEQ_SET_BPM: 'Tempo',
  SEQ_SET_SONG_LENGTH: 'Song length',
  SEQ_SET_LOOP: 'Loop',
  SEQ_SET_BEATS_PER_BAR: 'Time signature',
  PATTERN_RENAME: 'Rename pattern',
  PATTERN_SET_LENGTH: 'Pattern length',
  TRACK_ADD: 'Add track',
  TRACK_REMOVE: 'Delete track',
  TRACK_DUPLICATE: 'Duplicate track',
  TRACK_MOVE: 'Move track',
  MARKER_ADD: 'Add section',
  MARKER_REMOVE: 'Remove section',
  SECTION_DUPLICATE: 'Duplicate section',
  SECTION_DELETE: 'Delete section',
  CLIP_ADD: 'Add clip',
  CLIP_MOVE: 'Move clip',
  CLIP_RESIZE: 'Resize clip',
  CLIP_DELETE: 'Delete clip',
  CLIP_DUPLICATE: 'Duplicate clip',
  CLIP_MAKE_UNIQUE: 'Make clip unique',
  CLIP_TOGGLE_MUTE: 'Mute clip',
  CLIP_SPLIT: 'Split clip',
  CLIP_SET_PATTERN: 'Change clip pattern',
  SEQ_ADD_NOTE: 'Add note',
  SEQ_REMOVE_NOTE: 'Delete note',
  SEQ_MOVE_NOTE: 'Move notes',
  SEQ_RESIZE_NOTE: 'Resize note',
  SEQ_SET_VELOCITY: 'Velocity',
  SEQ_CLEAR_PATTERN: 'Clear pattern',
  SEQ_DELETE_SELECTED: 'Delete notes',
  SEQ_PASTE: 'Paste notes',
  SEQ_QUANTIZE: 'Quantize',
  SEQ_ADD_LANE: 'Add automation lane',
  SEQ_REMOVE_LANE: 'Remove automation lane',
  SEQ_TOGGLE_LANE: 'Automation lane on / off',
  SEQ_ADD_POINT: 'Add automation point',
  SEQ_MOVE_POINT: 'Move automation point',
  SEQ_REMOVE_POINT: 'Delete automation point',
  SEQ_CLEAR_LANE: 'Clear automation',
};

const CHANNEL_LABELS: Record<string, string> = {
  gain: 'Fader', eqLow: 'EQ', eqMid: 'EQ', eqHigh: 'EQ',
  sendReverb: 'Reverb send', sendDelay: 'Delay send', sendChorus: 'Chorus send', sidechain: 'Sidechain',
};

/**
 * What an edit is called in the undo tooltip and History list ("Fader: Bass");
 * undefined if the action isn't an edit. `state` supplies track names.
 */
export function undoLabel(action: Action, state?: AppState): string | undefined {
  const onTrack = (name: string, trackId: string) => {
    const track = state?.sequencer.tracks.find((t) => t.id === trackId);
    return track ? `${name}: ${track.name}` : name;
  };
  switch (action.type) {
    case 'TRACK_UPDATE': {
      const p = action.patch;
      if ('muted' in p) return onTrack(p.muted ? 'Mute' : 'Unmute', action.trackId);
      if ('solo' in p) return onTrack(p.solo ? 'Solo' : 'Unsolo', action.trackId);
      if ('name' in p) return 'Rename track';
      if ('color' in p) return onTrack('Colour', action.trackId);
      if ('pan' in p) return onTrack('Pan', action.trackId);
      return undefined;
    }
    case 'TRACK_SET_PATCH':
      return onTrack(action.patch === null ? 'Reset instrument' : 'Instrument', action.trackId);
    case 'SEQ_SET_CHANNEL': {
      const names = new Set(Object.keys(action.channel).map((k) => CHANNEL_LABELS[k] ?? 'Mixer'));
      return onTrack(names.size === 1 ? [...names][0] : 'Mixer', action.trackId);
    }
    case 'SEQ_SET_ARP': return onTrack('Arpeggiator', action.trackId);
    case 'TRACK_SET_SOURCE': return onTrack('Change instrument', action.trackId);
    default: return UNDO_LABELS[action.type];
  }
}

export function useAppReducer(): StoreCtx {
  const [state, rawDispatch] = useReducer(reducer, undefined, () => {
    try {
      return restoreState(localStorage.getItem(LS_KEY), localStorage.getItem(LS_INSTRUMENTS));
    } catch (err) {
      // A corrupt save must never stop the app from opening
      console.warn('Saved session could not be restored; starting fresh.', err);
      return makeInitialAppState();
    }
  });

  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    const id = setTimeout(() => writeSession(state), PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [state]);

  // Don't lose the last few hundred milliseconds of edits on close
  useEffect(() => {
    const flush = () => writeSession(latest.current);
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  // Record an undo step ahead of song edits that don't push their own. A push
  // that changes nothing is dropped by the reducer, so explicit pushes from
  // components and this one never double up. Other stores (drums, effects)
  // ask for steps through the history module.
  const lastGesture = useRef<{ key: string; at: number } | null>(null);
  // A step pushed without a name takes the name of the edit that follows it
  const unnamed = useRef(false);
  const requestStep = useCallback((key: string | null, label?: string) => {
    const now = performance.now();
    const last = lastGesture.current;
    const sameGesture = key !== null && last?.key === key && now - last.at < UNDO_COALESCE_MS;
    if (!sameGesture) {
      rawDispatch({ type: 'SEQ_PUSH_UNDO', extras: snapshotParticipants(), label });
      unnamed.current = !label;
    }
    lastGesture.current = key === null ? null : { key, at: now };
  }, []);

  const dispatch = useCallback<Dispatch<Action>>((action) => {
    const key = autoUndoKey(action);
    if (key !== undefined) {
      requestStep(key, undoLabel(action, latest.current));
    } else if (action.type === 'SEQ_PUSH_UNDO' || action.type === 'SEQ_UNDO' || action.type === 'SEQ_REDO') {
      lastGesture.current = null;
      unnamed.current = action.type === 'SEQ_PUSH_UNDO' && !action.label;
      rawDispatch({ ...action, extras: snapshotParticipants() });
      return;
    } else if (unnamed.current) {
      const label = undoLabel(action, latest.current);
      if (label) {
        unnamed.current = false;
        rawDispatch({ type: 'SEQ_LABEL_UNDO', label });
      }
    }
    rawDispatch(action);
  }, [requestStep]);

  useEffect(() => {
    setUndoStepRequester(requestStep);
    return () => setUndoStepRequester(null);
  }, [requestStep]);

  // Undo/redo restored the other stores' part of the song
  const pending = state.sequencer.pendingRestore;
  useEffect(() => {
    if (pending) restoreParticipants(pending.extras);
  }, [pending]);

  return useMemo(() => ({ state, dispatch }), [state, dispatch]);
}
