// ─── Snap values ─────────────────────────────────────────────────────────────

export type SnapValue = '1/1' | '1/2' | '1/4' | '1/8' | '1/16' | '1/32';

/** Each snap value expressed in beats (assumes denominator = beat unit) */
export const SNAP_BEATS: Record<SnapValue, number> = {
  '1/1':  4,
  '1/2':  2,
  '1/4':  1,
  '1/8':  0.5,
  '1/16': 0.25,
  '1/32': 0.125,
};

export const SNAP_OPTIONS: SnapValue[] = ['1/1', '1/2', '1/4', '1/8', '1/16', '1/32'];

// ─── Sequencer data model ─────────────────────────────────────────────────────

export interface SequencerNote {
  id: string;
  midiNote: number;      // 0–127
  startBeat: number;     // beats from song start
  durationBeats: number;
  velocity: number;      // 0–127
}

// ─── Automation ───────────────────────────────────────────────────────────────

export type AutomationTarget =
  | 'volume' | 'pan'
  | 'cutoff' | 'resonance' | 'drive'
  | 'sendReverb' | 'sendDelay' | 'sendChorus'
  | 'eqLow' | 'eqMid' | 'eqHigh';

export interface AutomationPoint {
  id: string;
  beat: number;
  /** Normalized 0–1; each target maps this onto its own range. */
  value: number;
}

export interface AutomationLane {
  id: string;
  target: AutomationTarget;
  enabled: boolean;
  points: AutomationPoint[];
}

// ─── Arpeggiator ──────────────────────────────────────────────────────────────

export type ArpMode = 'up' | 'down' | 'updown' | 'downup' | 'order' | 'random';

export const ARP_MODES: ArpMode[] = ['up', 'down', 'updown', 'downup', 'order', 'random'];

export interface ArpSettings {
  enabled: boolean;
  rate: SnapValue;
  mode: ArpMode;
  octaves: number;   // 1–4
  gate: number;      // 0.05–1 — fraction of each step the note sounds for
}

export function makeDefaultArp(): ArpSettings {
  return { enabled: false, rate: '1/16', mode: 'up', octaves: 1, gate: 0.65 };
}

// ─── Per-track channel strip ──────────────────────────────────────────────────

export interface ChannelSettings {
  gain: number;        // 0–1.5
  eqLow: number;       // -18 … +18 dB  (low shelf, 200 Hz)
  eqMid: number;       // -18 … +18 dB  (peaking, 1.2 kHz)
  eqHigh: number;      // -18 … +18 dB  (high shelf, 4 kHz)
  sendReverb: number;  // 0–1
  sendDelay: number;   // 0–1
  sendChorus: number;  // 0–1
  /** Duck depth when the drum machine's kick fires. 0 = no sidechain. */
  sidechain: number;   // 0–1
}

export function makeDefaultChannel(): ChannelSettings {
  return {
    gain: 1, eqLow: 0, eqMid: 0, eqHigh: 0,
    sendReverb: 0, sendDelay: 0, sendChorus: 0, sidechain: 0,
  };
}

// ─── Tracks, clips and patterns ───────────────────────────────────────────────
//
// The arrangement follows the model every mainstream DAW converged on:
//
//   Track ── owns a sound source, channel strip, arpeggiator and automation
//     └─ Clip ── a region on the timeline that plays a Pattern
//          └─ Pattern ── the notes, in pattern-relative beats, looped to fill the clip
//
// Clips that share a pattern are "linked": editing one edits all of them.
// Duplicating a clip makes an independent copy by default, as in Ableton and Logic.

/** Where a track's sound comes from. Oscillator lab tabs are optional extras. */
export type TrackSource =
  | { type: 'preset'; presetId: string }
  | { type: 'drums' }
  | { type: 'oscillator'; tabId: string };

export interface Clip {
  id: string;
  /** A note pattern id, or a drum pattern id on drum tracks. */
  patternId: string;
  startBeat: number;
  lengthBeats: number;
  /** Where in the pattern the clip starts playing (set by trimming the left edge). */
  offsetBeats: number;
  muted: boolean;
}

export interface Pattern {
  id: string;
  name: string;
  /** Loop length — a clip longer than this repeats the pattern. */
  lengthBeats: number;
  notes: SequencerNote[];
}

export interface Track {
  id: string;
  name: string;
  color: string;
  source: TrackSource;
  clips: Clip[];
  muted: boolean;
  solo: boolean;
  pan: number;           // -1 (left) to +1 (right)
  arp: ArpSettings;
  channel: ChannelSettings;
  lanes: AutomationLane[];
  /** Arrangement UI: automation lane expanded under the track, and which lane. */
  showAutomation: boolean;
  activeLaneId: string | null;
}

/** A named section start. A section runs until the next marker or the song end. */
export interface Marker {
  id: string;
  beat: number;
  name: string;
  color: string;
}

/** The undoable part of the sequencer — what a project file is made of. */
export interface DocSnapshot {
  tracks: Track[];
  patterns: Record<string, Pattern>;
  markers: Marker[];
}

// ─── IDs ──────────────────────────────────────────────────────────────────────
//
// Random suffixes rather than a per-session counter: a counter restarts at 1
// on reload and collides with ids already saved in localStorage.

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export const TRACK_COLORS = [
  '#00ff88', '#ffb000', '#00aaff', '#ff4466',
  '#cc44ff', '#ff8800', '#44ffcc', '#ff66aa',
  '#a3e635', '#38bdf8', '#f472b6', '#facc15',
];

export const SECTION_COLORS = ['#6366f1', '#0ea5e9', '#22c55e', '#eab308', '#f97316', '#ec4899', '#a855f7', '#14b8a6'];

// ─── Factories ────────────────────────────────────────────────────────────────

export function makeTrack(opts: {
  name: string;
  source: TrackSource;
  color?: string;
  index?: number;
}): Track {
  return {
    id: uid('trk'),
    name: opts.name,
    color: opts.color ?? TRACK_COLORS[(opts.index ?? 0) % TRACK_COLORS.length],
    source: opts.source,
    clips: [],
    muted: false,
    solo: false,
    pan: 0,
    arp: makeDefaultArp(),
    channel: makeDefaultChannel(),
    lanes: [],
    showAutomation: false,
    activeLaneId: null,
  };
}

export function makePattern(name: string, lengthBeats: number, notes: SequencerNote[] = []): Pattern {
  return { id: uid('pat'), name, lengthBeats, notes };
}

export function makeClip(patternId: string, startBeat: number, lengthBeats: number): Clip {
  return { id: uid('clip'), patternId, startBeat, lengthBeats, offsetBeats: 0, muted: false };
}

/** Fill in fields a saved track may predate, and repair anything malformed. */
export function normalizeTrack(t: Partial<Track> & { id: string }, index = 0): Track {
  return {
    id: t.id,
    name: t.name ?? `Track ${index + 1}`,
    color: t.color ?? TRACK_COLORS[index % TRACK_COLORS.length],
    source: t.source ?? { type: 'preset', presetId: 'keys-epiano' },
    clips: (t.clips ?? []).map((c) => ({
      id: c.id ?? uid('clip'),
      patternId: c.patternId,
      startBeat: Math.max(0, c.startBeat ?? 0),
      lengthBeats: Math.max(0.25, c.lengthBeats ?? 4),
      offsetBeats: Math.max(0, c.offsetBeats ?? 0),
      muted: !!c.muted,
    })),
    muted: !!t.muted,
    solo: !!t.solo,
    pan: t.pan ?? 0,
    arp: { ...makeDefaultArp(), ...t.arp },
    channel: { ...makeDefaultChannel(), ...t.channel },
    lanes: (t.lanes ?? []).map((l) => ({
      ...l,
      points: [...(l.points ?? [])].sort((a, b) => a.beat - b.beat),
    })),
    showAutomation: !!t.showAutomation,
    activeLaneId: t.activeLaneId ?? null,
  };
}

/** Effective mute for each track, honouring solo. */
export function effectiveTrackMutes(tracks: Track[]): Map<string, boolean> {
  const anySolo = tracks.some((t) => t.solo);
  const out = new Map<string, boolean>();
  for (const t of tracks) out.set(t.id, t.muted || (anySolo && !t.solo));
  return out;
}

/** Last beat any clip reaches. */
export function contentEndBeat(tracks: Track[]): number {
  let end = 0;
  for (const t of tracks) for (const c of t.clips) end = Math.max(end, c.startBeat + c.lengthBeats);
  return end;
}

/** Sections derived from markers: each runs to the next marker or the song end. */
export function sectionsFromMarkers(
  markers: Marker[],
  songEndBeat: number,
): (Marker & { endBeat: number })[] {
  const sorted = [...markers].sort((a, b) => a.beat - b.beat);
  return sorted.map((m, i) => ({
    ...m,
    endBeat: Math.max(m.beat, i + 1 < sorted.length ? sorted[i + 1].beat : songEndBeat),
  }));
}

export interface SequencerState {
  bpm: number;
  beatsPerBar: number;
  snapValue: SnapValue;          // piano roll grid
  arrangeSnap: SnapValue;        // arrangement grid
  defaultNoteLength: SnapValue;  // duration of newly drawn notes
  loopEnabled: boolean;
  loopStartBeat: number;
  loopEndBeat: number;
  songLengthBars: number;
  isPlaying: boolean;
  /** Last stopped / seeked position. Live position during playback lives in playheadStore. */
  playheadBeat: number;
  metronome: boolean;
  editMode: 'draw' | 'select';
  tracks: Track[];
  patterns: Record<string, Pattern>;
  markers: Marker[];
  selectedTrackId: string | null;
  selectedClipId: string | null;
  selectedNoteIds: string[];
  copiedNotes: SequencerNote[] | null;  // note clipboard
  showVelocityLane: boolean;            // show velocity editing lane
  // Piano roll view (pattern-relative)
  viewStartBeat: number;
  pxPerBeat: number;
  viewLowNote: number;
  viewHighNote: number;
  // Arrangement view
  arrStartBeat: number;
  arrPxPerBeat: number;
  undoStack: DocSnapshot[];
  redoStack: DocSnapshot[];
}

export function makeDefaultSequencerState(): SequencerState {
  return {
    bpm: 120,
    beatsPerBar: 4,
    snapValue: '1/16',
    arrangeSnap: '1/1',
    defaultNoteLength: '1/8',
    loopEnabled: false,
    loopStartBeat: 0,
    loopEndBeat: 16,
    songLengthBars: 16,
    isPlaying: false,
    playheadBeat: 0,
    metronome: false,
    editMode: 'draw',
    tracks: [],
    patterns: {},
    markers: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedNoteIds: [],
    copiedNotes: null,
    showVelocityLane: false,
    viewStartBeat: 0,
    pxPerBeat: 80,
    viewLowNote: 48,   // C3
    viewHighNote: 84,  // C6
    arrStartBeat: 0,
    arrPxPerBeat: 18,
    undoStack: [],
    redoStack: [],
  };
}

// ─── MIDI utilities ───────────────────────────────────────────────────────────

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export function midiToFreq(midiNote: number): number {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

export function noteNameFromMidi(midiNote: number): string {
  const octave = Math.floor(midiNote / 12) - 1;
  return `${NOTE_NAMES[midiNote % 12]}${octave}`;
}

export function isBlackKey(midiNote: number): boolean {
  return [1, 3, 6, 8, 10].includes(midiNote % 12);
}

// ─── Beat / time math ─────────────────────────────────────────────────────────

export function beatsToSeconds(beats: number, bpm: number): number {
  return beats * (60 / bpm);
}

export function secondsToBeats(seconds: number, bpm: number): number {
  return seconds * (bpm / 60);
}

/** Snap a beat position to the nearest grid line. Returns raw beat if shift held. */
export function snapBeat(beat: number, snap: SnapValue, shiftHeld = false): number {
  if (shiftHeld) return beat;
  const grid = SNAP_BEATS[snap];
  return Math.round(beat / grid) * grid;
}

/** Format beat position as MM:SS.d */
export function formatBeatsAsTime(beats: number, bpm: number): string {
  const total = beatsToSeconds(beats, bpm);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const d = Math.floor((total * 10) % 10);
  return `${m}:${String(s).padStart(2, '0')}.${d}`;
}

/** Beat → bar and beat-within-bar (1-based display). */
export function beatToBarBeat(beat: number, bpb: number): { bar: number; beat: number } {
  const b = Math.max(0, beat);
  return { bar: Math.floor(b / bpb) + 1, beat: Math.floor(b % bpb) + 1 };
}

// ─── Note ID generator ────────────────────────────────────────────────────────

let _nid = 0;
export function makeNoteId(): string {
  return `n-${Date.now()}-${_nid++}`;
}

// ─── Piano grid constants (used by PianoRoll and SequencerEngine) ─────────────

export const SEMITONE_H = 14;   // canvas pixels per semitone row
export const KEY_W = 52;        // width of the piano-keys sidebar
export const RULER_H = 24;      // height of the timeline ruler
export const MIN_NOTE_W = 6;    // minimum rendered note width in pixels
