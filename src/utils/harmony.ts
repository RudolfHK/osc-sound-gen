/**
 * Harmony: chord symbols, keys and chord detection. Pure and unit-tested;
 * used by the chord track, the piano roll's chord highlight and the part
 * generator.
 */

/** A chord on the chord track. It lasts until the next chord (or the song end). */
export interface ChordMark {
  id: string;
  beat: number;
  /** Pitch class of the root, 0 = C … 11 = B. */
  root: number;
  quality: ChordQuality;
  /** Slash-chord bass note (pitch class), when it isn't the root. */
  bass?: number;
}

export type ChordQuality =
  | 'maj' | 'min' | 'dim' | 'aug' | 'sus2' | 'sus4'
  | '7' | 'maj7' | 'm7' | 'm7b5' | 'dim7' | '6' | 'm6'
  | 'add9' | '9' | 'maj9' | 'm9';

/** Intervals above the root (12+ is the next octave) and the symbol suffix. */
export const QUALITIES: Record<ChordQuality, { intervals: number[]; symbol: string; name: string }> = {
  maj:  { intervals: [0, 4, 7], symbol: '', name: 'Major' },
  min:  { intervals: [0, 3, 7], symbol: 'm', name: 'Minor' },
  dim:  { intervals: [0, 3, 6], symbol: 'dim', name: 'Diminished' },
  aug:  { intervals: [0, 4, 8], symbol: 'aug', name: 'Augmented' },
  sus2: { intervals: [0, 2, 7], symbol: 'sus2', name: 'Suspended 2nd' },
  sus4: { intervals: [0, 5, 7], symbol: 'sus4', name: 'Suspended 4th' },
  '7':  { intervals: [0, 4, 7, 10], symbol: '7', name: 'Dominant 7th' },
  maj7: { intervals: [0, 4, 7, 11], symbol: 'maj7', name: 'Major 7th' },
  m7:   { intervals: [0, 3, 7, 10], symbol: 'm7', name: 'Minor 7th' },
  m7b5: { intervals: [0, 3, 6, 10], symbol: 'm7♭5', name: 'Half-diminished' },
  dim7: { intervals: [0, 3, 6, 9], symbol: 'dim7', name: 'Diminished 7th' },
  '6':  { intervals: [0, 4, 7, 9], symbol: '6', name: 'Major 6th' },
  m6:   { intervals: [0, 3, 7, 9], symbol: 'm6', name: 'Minor 6th' },
  add9: { intervals: [0, 4, 7, 14], symbol: 'add9', name: 'Add 9' },
  '9':  { intervals: [0, 4, 7, 10, 14], symbol: '9', name: 'Dominant 9th' },
  maj9: { intervals: [0, 4, 7, 11, 14], symbol: 'maj9', name: 'Major 9th' },
  m9:   { intervals: [0, 3, 7, 10, 14], symbol: 'm9', name: 'Minor 9th' },
};

export const QUALITY_ORDER = Object.keys(QUALITIES) as ChordQuality[];

const SHARPS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLATS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

const pc = (n: number) => ((Math.round(n) % 12) + 12) % 12;

export function noteName(pitchClass: number, preferFlats = false): string {
  return (preferFlats ? FLATS : SHARPS)[pc(pitchClass)];
}

export interface SongKey {
  tonic: number;
  mode: 'major' | 'minor';
}

/** Keys written with flats: F, B♭, E♭… major and D, G, C… minor. */
export function keyUsesFlats(key: SongKey | null | undefined): boolean {
  if (!key) return false;
  const major = key.mode === 'major' ? key.tonic : pc(key.tonic + 3);
  return [5, 10, 3, 8, 1, 6].includes(major);
}

export function keyName(key: SongKey): string {
  return `${noteName(key.tonic, keyUsesFlats(key))} ${key.mode}`;
}

/** "Am7", "F/C", "B♭maj7". */
export function chordName(c: Pick<ChordMark, 'root' | 'quality' | 'bass'>, preferFlats = false): string {
  const base = noteName(c.root, preferFlats) + QUALITIES[c.quality].symbol;
  return c.bass !== undefined && pc(c.bass) !== pc(c.root) ? `${base}/${noteName(c.bass, preferFlats)}` : base;
}

/** The chord's pitch classes (the slash bass included). */
export function chordPitchClasses(c: Pick<ChordMark, 'root' | 'quality' | 'bass'>): Set<number> {
  const s = new Set(QUALITIES[c.quality].intervals.map((i) => pc(c.root + i)));
  if (c.bass !== undefined) s.add(pc(c.bass));
  return s;
}

/** Chord tones as MIDI notes, root position from `rootMidi`. */
export function chordTones(c: Pick<ChordMark, 'root' | 'quality'>, rootMidi: number): number[] {
  return QUALITIES[c.quality].intervals.map((i) => rootMidi + i);
}

/** The chord sounding at `beat` (chords sorted by beat), or null before the first one. */
export function chordAt<T extends { beat: number }>(chords: T[], beat: number): T | null {
  let found: T | null = null;
  for (const c of chords) {
    if (c.beat <= beat + 1e-9) found = c; else break;
  }
  return found;
}

/** Each chord with the beat it ends on (the next chord, or `songEnd`). */
export function chordSpans<T extends { beat: number }>(chords: T[], songEnd: number): (T & { endBeat: number })[] {
  const sorted = [...chords].sort((a, b) => a.beat - b.beat);
  return sorted.map((c, i) => ({ ...c, endBeat: Math.max(c.beat, i + 1 < sorted.length ? sorted[i + 1].beat : songEnd) }));
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SUFFIXES: [string, ChordQuality][] = [
  ['maj9', 'maj9'], ['maj7', 'maj7'], ['M7', 'maj7'], ['Δ7', 'maj7'], ['Δ', 'maj7'],
  ['m7b5', 'm7b5'], ['m7♭5', 'm7b5'], ['ø', 'm7b5'], ['dim7', 'dim7'], ['°7', 'dim7'],
  ['m9', 'm9'], ['m7', 'm7'], ['m6', 'm6'], ['min', 'min'], ['m', 'min'], ['-', 'min'],
  ['dim', 'dim'], ['°', 'dim'], ['aug', 'aug'], ['+', 'aug'],
  ['sus2', 'sus2'], ['sus4', 'sus4'], ['sus', 'sus4'], ['add9', 'add9'],
  ['9', '9'], ['7', '7'], ['6', '6'], ['maj', 'maj'], ['', 'maj'],
];

function parseNote(s: string): [number, string] | null {
  const m = s.match(/^([A-Ga-g])([#♯b♭]?)/);
  if (!m) return null;
  let p = LETTER[m[1].toUpperCase()];
  if (m[2] === '#' || m[2] === '♯') p += 1;
  if (m[2] === 'b' || m[2] === '♭') p -= 1;
  return [pc(p), s.slice(m[0].length)];
}

/** "Am7" → A minor 7th; "Bb/D" → B♭ over D. Null if it isn't a chord symbol. */
export function parseChord(text: string): Pick<ChordMark, 'root' | 'quality' | 'bass'> | null {
  const t = text.trim().replace(/\s+/g, '');
  if (!t) return null;
  const [main, slash] = t.split('/');
  const root = parseNote(main);
  if (!root) return null;
  const [r, rest] = root;
  const quality = SUFFIXES.find(([suf]) => rest === suf)?.[1];
  if (!quality) return null;
  if (slash === undefined) return { root: r, quality };
  const bass = parseNote(slash);
  if (!bass || bass[1] !== '') return null;
  return { root: r, quality, bass: bass[0] };
}

// ─── Keys ─────────────────────────────────────────────────────────────────────

// Krumhansl–Kessler key profiles
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlation(a: number[], b: number[]): number {
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** How well a histogram fits one key (correlation with its profile, −1…1). */
export function keyCorrelation(histogram: number[], key: SongKey): number {
  const profile = key.mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE;
  return correlation(histogram.map((_, i) => histogram[(i + key.tonic) % 12]), profile);
}

/**
 * The most likely key for a pitch-class histogram (weights per pitch class,
 * e.g. total note duration), with a confidence (correlation, −1…1). Null when
 * there's nothing to go on.
 */
export function detectKey(histogram: number[]): (SongKey & { confidence: number }) | null {
  if (histogram.length !== 12 || histogram.every((w) => w <= 0)) return null;
  let best: (SongKey & { confidence: number }) | null = null;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const [mode, profile] of [['major', MAJOR_PROFILE], ['minor', MINOR_PROFILE]] as const) {
      const rotated = histogram.map((_, i) => histogram[(i + tonic) % 12]);
      const r = correlation(rotated, profile);
      if (!best || r > best.confidence) best = { tonic, mode, confidence: r };
    }
  }
  return best;
}

/** Pitch-class histogram of notes, weighted by duration. */
export function pitchHistogram(notes: { midiNote: number; durationBeats: number; velocity?: number }[]): number[] {
  const h = new Array(12).fill(0);
  for (const n of notes) h[pc(n.midiNote)] += Math.max(0.05, n.durationBeats) * ((n.velocity ?? 100) / 127);
  return h;
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

export function scalePitchClasses(key: SongKey): number[] {
  return (key.mode === 'major' ? MAJOR_SCALE : MINOR_SCALE).map((i) => pc(key.tonic + i));
}

export interface DiatonicChord {
  numeral: string;
  chord: Pick<ChordMark, 'root' | 'quality'>;
}

/**
 * The key's chords, as triads or sevenths. Minor keys also offer the major V
 * (and V7) from harmonic minor, which most minor-key music uses.
 */
export function diatonicChords(key: SongKey, sevenths = false): DiatonicChord[] {
  const t = key.tonic;
  const triads: [string, number, ChordQuality, ChordQuality][] = key.mode === 'major'
    ? [['I', 0, 'maj', 'maj7'], ['ii', 2, 'min', 'm7'], ['iii', 4, 'min', 'm7'], ['IV', 5, 'maj', 'maj7'],
       ['V', 7, 'maj', '7'], ['vi', 9, 'min', 'm7'], ['vii°', 11, 'dim', 'm7b5']]
    : [['i', 0, 'min', 'm7'], ['ii°', 2, 'dim', 'm7b5'], ['III', 3, 'maj', 'maj7'], ['iv', 5, 'min', 'm7'],
       ['v', 7, 'min', 'm7'], ['V', 7, 'maj', '7'], ['VI', 8, 'maj', 'maj7'], ['VII', 10, 'maj', '7']];
  return triads.map(([numeral, step, tri, sev]) => ({ numeral, chord: { root: pc(t + step), quality: sevenths ? sev : tri } }));
}

/** Well-known progressions, as numerals of `diatonicChords`. */
export const PROGRESSIONS: { name: string; mode: SongKey['mode']; numerals: string[] }[] = [
  { name: 'Pop (I–V–vi–IV)', mode: 'major', numerals: ['I', 'V', 'vi', 'IV'] },
  { name: 'Ballad (vi–IV–I–V)', mode: 'major', numerals: ['vi', 'IV', 'I', 'V'] },
  { name: '50s (I–vi–IV–V)', mode: 'major', numerals: ['I', 'vi', 'IV', 'V'] },
  { name: 'Jazz turnaround (ii–V–I–I)', mode: 'major', numerals: ['ii', 'V', 'I', 'I'] },
  { name: 'Epic minor (i–VI–III–VII)', mode: 'minor', numerals: ['i', 'VI', 'III', 'VII'] },
  { name: 'Descending (i–VII–VI–V)', mode: 'minor', numerals: ['i', 'VII', 'VI', 'V'] },
  { name: 'Minor drive (i–iv–v–i)', mode: 'minor', numerals: ['i', 'iv', 'v', 'i'] },
  { name: 'Deep house (i–VI–iv–v)', mode: 'minor', numerals: ['i', 'VI', 'iv', 'v'] },
];

/** A progression's chords in a key (the progression's own mode wins). */
export function progressionChords(key: SongKey, numerals: string[], mode: SongKey['mode'], sevenths = false): Pick<ChordMark, 'root' | 'quality'>[] {
  const table = diatonicChords({ tonic: key.mode === mode ? key.tonic : mode === 'minor' ? pc(key.tonic + 9) : pc(key.tonic + 3), mode }, sevenths);
  return numerals.map((n) => table.find((d) => d.numeral === n)?.chord ?? table[0].chord);
}

// ─── Chord detection ──────────────────────────────────────────────────────────

const DETECTABLE: ChordQuality[] = ['maj', 'min', '7', 'maj7', 'm7', 'dim', 'sus4', 'sus2', 'm7b5'];

/**
 * The chord that best explains a set of notes: every chord tone present
 * scores, every other note costs, and the lowest note pulls towards being the
 * root. Null when the notes are too sparse to say.
 */
export function detectChord(notes: { midiNote: number; durationBeats: number; velocity?: number }[]): Pick<ChordMark, 'root' | 'quality'> | null {
  if (notes.length < 2) return null;
  const h = pitchHistogram(notes);
  const total = h.reduce((s, x) => s + x, 0);
  if (total <= 0 || h.filter((x) => x > total * 0.04).length < 2) return null;
  const bassPc = pc(Math.min(...notes.map((n) => n.midiNote)));
  let best: { root: number; quality: ChordQuality; score: number } | null = null;
  for (let root = 0; root < 12; root++) {
    for (const quality of DETECTABLE) {
      const tones = new Set(QUALITIES[quality].intervals.map((i) => pc(root + i)));
      let score = 0;
      for (let p = 0; p < 12; p++) score += tones.has(p) ? h[p] : -0.75 * h[p];
      // Each chord tone that's missing costs a little; sevenths need theirs
      for (const t of tones) if (h[t] < total * 0.02) score -= total * (tones.size > 3 ? 0.2 : 0.12);
      if (root === bassPc) score += total * 0.15;
      if (!best || score > best.score + 1e-9) best = { root, quality, score };
    }
  }
  return best && best.score > 0 ? { root: best.root, quality: best.quality } : null;
}
