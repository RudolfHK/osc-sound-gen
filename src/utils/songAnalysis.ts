/**
 * What the song plays, for harmony: the notes sounding in a range (clips
 * loop their patterns), the song's key, and chords detected bar by bar.
 */
import type { Pattern, Track } from './music';
import { detectChord, detectKey, keyCorrelation, pitchHistogram, type ChordMark, type SongKey } from './harmony';

export interface SoundingNote {
  midiNote: number;
  /** How long the note sounds inside the range, in beats. */
  durationBeats: number;
  velocity: number;
}

/**
 * Every note from the instrument tracks that sounds in [from, to), with its
 * duration clipped to the range. Drum tracks, muted tracks and muted clips
 * don't count: they say nothing about the harmony.
 */
export function notesInRange(tracks: Track[], patterns: Record<string, Pattern>, from: number, to: number): SoundingNote[] {
  const out: SoundingNote[] = [];
  for (const t of tracks) {
    if (t.source.type === 'drums' || t.muted) continue;
    for (const c of t.clips) {
      if (c.muted) continue;
      const cEnd = c.startBeat + c.lengthBeats;
      if (cEnd <= from || c.startBeat >= to) continue;
      const p = patterns[c.patternId];
      if (!p || p.lengthBeats <= 0) continue;
      const L = p.lengthBeats;
      // Song time of pattern time q in repeat k: c.startBeat + k·L + q − offset
      const off = c.offsetBeats % L;
      const kFirst = Math.floor((Math.max(from, c.startBeat) - c.startBeat + off - L) / L);
      const kLast = Math.ceil((Math.min(to, cEnd) - c.startBeat + off) / L);
      for (let k = kFirst; k <= kLast; k++) {
        for (const n of p.notes) {
          if (n.startBeat >= L) continue;
          const s = c.startBeat + k * L + n.startBeat - off;
          // Like playback: a note rings for its length, cut only at the clip's end
          const e = Math.min(s + n.durationBeats, cEnd);
          const a = Math.max(s, from, c.startBeat);
          const b = Math.min(e, to);
          if (b - a > 1e-6) out.push({ midiNote: n.midiNote, durationBeats: b - a, velocity: n.velocity });
        }
      }
    }
  }
  return out;
}

/**
 * The key the song is in, from every note it plays. Null if it has none.
 *
 * Note counts alone often leave several keys close — relative keys share all
 * their notes, and a modal song can look like its neighbour. Among the keys
 * that fit nearly as well as the best, the chords decide: whichever key's
 * tonic chord the song opens on, ends on and keeps returning to.
 */
export function detectSongKey(
  tracks: Track[], patterns: Record<string, Pattern>, songEnd: number, beatsPerBar = 4,
): (SongKey & { confidence: number }) | null {
  const h = pitchHistogram(notesInRange(tracks, patterns, 0, songEnd));
  const best = detectKey(h);
  if (!best) return null;
  const candidates: (SongKey & { confidence: number })[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor'] as const) {
      const confidence = keyCorrelation(h, { tonic, mode });
      if (confidence >= best.confidence - 0.15) candidates.push({ tonic, mode, confidence });
    }
  }
  if (candidates.length < 2) return best;

  // Evidence for a key: bars spent on its tonic chord, plus the song opening
  // on its tonic (by root alone — an intro is often just bass) and ending on it
  const chords = detectChordsInRange(tracks, patterns, 0, songEnd, beatsPerBar);
  const tonicScore = (k: SongKey) => chords.reduce((score, c, i) => {
    const bars = ((chords[i + 1]?.beat ?? songEnd) - c.beat) / beatsPerBar;
    const quality = k.mode === 'major'
      ? ['maj', 'maj7', '6', 'add9', 'maj9'].includes(c.quality)
      : ['min', 'm7', 'm6', 'm9'].includes(c.quality);
    const rootMatch = c.root === k.tonic;
    return score
      + (rootMatch && quality ? bars : 0)
      + (i === 0 && rootMatch ? 3 : 0)
      + (i === chords.length - 1 && rootMatch && quality ? 2 : 0);
  }, 0);
  return candidates
    .map((k) => ({ k, score: tonicScore(k) }))
    .sort((a, b) => b.score - a.score || b.k.confidence - a.k.confidence)[0].k;
}

/**
 * Chords for [from, to), one per bar, merged where a chord carries on. Bars
 * with too little harmony to judge continue the previous chord.
 */
export function detectChordsInRange(
  tracks: Track[], patterns: Record<string, Pattern>, from: number, to: number, beatsPerBar: number,
): Omit<ChordMark, 'id'>[] {
  const out: Omit<ChordMark, 'id'>[] = [];
  for (let bar = from; bar < to - 1e-6; bar += beatsPerBar) {
    const chord = detectChord(notesInRange(tracks, patterns, bar, Math.min(to, bar + beatsPerBar)));
    if (!chord) continue;
    const prev = out[out.length - 1];
    if (prev && prev.root === chord.root && prev.quality === chord.quality) continue;
    out.push({ beat: bar, ...chord });
  }
  return out;
}
