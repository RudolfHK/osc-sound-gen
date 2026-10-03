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

export interface SequencerTrack {
  tabId: string;
  notes: SequencerNote[];
  pan: number;           // -1 (left) to +1 (right)
  arp: ArpSettings;
  channel: ChannelSettings;
  lanes: AutomationLane[];
}

export function makeTrack(tabId: string): SequencerTrack {
  return {
    tabId, notes: [], pan: 0,
    arp: makeDefaultArp(),
    channel: makeDefaultChannel(),
    lanes: [],
  };
}

/** Fill in fields added after a project or session was saved. */
export function normalizeTrack(t: Partial<SequencerTrack> & { tabId: string }): SequencerTrack {
  return {
    tabId: t.tabId,
    notes: t.notes ?? [],
    pan: t.pan ?? 0,
    arp: { ...makeDefaultArp(), ...t.arp },
    channel: { ...makeDefaultChannel(), ...t.channel },
    lanes: (t.lanes ?? []).map((l) => ({
      ...l,
      points: [...l.points].sort((a, b) => a.beat - b.beat),
    })),
  };
}

export interface SequencerState {
  isOpen: boolean;
  bpm: number;
  beatsPerBar: number;
  snapValue: SnapValue;
  defaultNoteLength: SnapValue;  // duration of newly drawn notes
  loopEnabled: boolean;
  loopStartBeat: number;
  loopEndBeat: number;
  songLengthBars: number;
  isPlaying: boolean;
  playheadBeat: number;
  editMode: 'draw' | 'select';
  tracks: SequencerTrack[];
  selectedNoteIds: string[];
  copiedNotes: SequencerNote[] | null;  // note clipboard
  showVelocityLane: boolean;            // show velocity editing lane
  activeLaneId: string | null;          // automation lane open in the editor
  viewStartBeat: number;
  pxPerBeat: number;     // horizontal zoom, shared by the piano roll and automation lanes
  viewLowNote: number;   // lowest visible MIDI note
  viewHighNote: number;  // highest visible MIDI note
  undoStack: SequencerTrack[][];
  redoStack: SequencerTrack[][];
}

export interface SequencerProject {
  version: string;
  name: string;
  savedAt: string;
  bpm: number;
  beatsPerBar: number;
  songLengthBars: number;
  tracks: SequencerTrack[];
  masterVolume: number;
}

export function makeDefaultSequencerState(): SequencerState {
  return {
    isOpen: false,
    bpm: 120,
    beatsPerBar: 4,
    snapValue: '1/16',
    defaultNoteLength: '1/8',
    loopEnabled: true,
    loopStartBeat: 0,
    loopEndBeat: 16,
    songLengthBars: 8,
    isPlaying: false,
    playheadBeat: 0,
    editMode: 'draw',
    tracks: [],
    selectedNoteIds: [],
    copiedNotes: null,
    showVelocityLane: false,
    activeLaneId: null,
    viewStartBeat: 0,
    pxPerBeat: 80,
    viewLowNote: 48,   // C3
    viewHighNote: 84,  // C6
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
