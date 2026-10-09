/**
 * Pure timeline maths for the scheduler — no Web Audio here, so it can be
 * unit-tested.
 *
 * Two clocks are involved:
 *  - **mono** beats increase forever from the moment play is pressed; the
 *    scheduler's lookahead windows are expressed in them.
 *  - **song** beats are positions in the arrangement; with looping on, mono
 *    time wraps back into the loop.
 *
 * The scheduler asks for events in successive half-open mono windows
 * [a, b). Each window is split into song-time segments at loop wraps, and every
 * event is attributed to exactly one window — so nothing is ever scheduled
 * twice, which is what made the previous per-note bookkeeping necessary.
 */

import type { Clip, Pattern, SequencerNote, Track } from '../utils/music';
import type { DrumPattern, DrumStep, DrumVoiceConfig } from '../store/drumStore';

// ─── Loop mapping ─────────────────────────────────────────────────────────────

export interface LoopConfig {
  enabled: boolean;
  start: number;
  end: number;
}

/**
 * Whether the loop applies for a playback that started at `playStart`.
 * Starting past the loop end plays straight through, as in every DAW.
 */
export function loopEngaged(loop: LoopConfig, playStart: number): boolean {
  return loop.enabled && loop.end - loop.start > 1e-6 && playStart < loop.end;
}

/** Song position for a mono position. */
export function monoToSong(mono: number, loop: LoopConfig, engaged: boolean): number {
  if (!engaged || mono < loop.end) return mono;
  const len = loop.end - loop.start;
  return loop.start + ((mono - loop.start) % len);
}

export interface Segment {
  songStart: number;
  songEnd: number;
  /** mono = song + offset, for every position in this segment. */
  offset: number;
}

/** Split a mono window into contiguous song-time segments. */
export function windowSegments(a: number, b: number, loop: LoopConfig, engaged: boolean): Segment[] {
  if (b <= a) return [];
  if (!engaged) return [{ songStart: a, songEnd: b, offset: 0 }];

  const len = loop.end - loop.start;
  const out: Segment[] = [];
  let m = a;
  // Guard against pathological tiny loops producing thousands of segments
  for (let guard = 0; m < b - 1e-9 && guard < 10_000; guard++) {
    if (m < loop.end) {
      const e = Math.min(b, loop.end);
      out.push({ songStart: m, songEnd: e, offset: 0 });
      m = e;
    } else {
      const rep = Math.floor((m - loop.start) / len + 1e-9);
      const repEndMono = loop.start + (rep + 1) * len;
      const song = m - rep * len;
      const e = Math.min(b, repEndMono);
      out.push({ songStart: song, songEnd: song + (e - m), offset: rep * len });
      m = e;
    }
  }
  return out;
}

// ─── Clip occurrences ─────────────────────────────────────────────────────────

/**
 * Song positions at which a pattern position `q` sounds inside a clip, limited
 * to [s0, s1). A clip longer than its pattern repeats it; `offsetBeats` shifts
 * which part of the pattern the clip starts on.
 */
export function occurrences(
  clip: Pick<Clip, 'startBeat' | 'lengthBeats' | 'offsetBeats'>,
  patternLength: number,
  q: number,
  s0: number,
  s1: number,
): number[] {
  const P = patternLength;
  if (P <= 0 || q < 0 || q >= P) return [];
  const ua = Math.max(0, s0 - clip.startBeat);
  const ub = Math.min(clip.lengthBeats, s1 - clip.startBeat);
  if (ub <= ua) return [];

  // u = q - offset + k·P, find every k with u in [ua, ub)
  const base = q - (clip.offsetBeats % P);
  const kStart = Math.ceil((ua - base) / P - 1e-9);
  const out: number[] = [];
  for (let k = kStart; ; k++) {
    const u = base + k * P;
    if (u >= ub - 1e-9) break;
    if (u >= ua - 1e-9) out.push(clip.startBeat + u);
  }
  return out;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export interface NoteEvent {
  kind: 'note';
  track: Track;
  songBeat: number;
  monoBeat: number;
  midiNote: number;
  velocity: number;
  /** Already truncated so it never sounds past the end of its clip. */
  durationBeats: number;
}

export interface DrumEvent {
  kind: 'drum';
  track: Track;
  songBeat: number;
  monoBeat: number;
  voice: DrumVoiceConfig;
  step: DrumStep;
  /** Swing delay in beats, applied to playback time only. */
  swingBeats: number;
}

export interface ClickEvent {
  kind: 'click';
  monoBeat: number;
  accent: boolean;
}

export type TimelineEvent = NoteEvent | DrumEvent | ClickEvent;

export interface TimelineInput {
  tracks: Track[];
  patterns: Record<string, Pattern>;
  drumPatterns: Map<string, DrumPattern>;
  /** Notes to actually play for a track's pattern — the arpeggiator hooks in here. */
  notesFor: (track: Track, pattern: Pattern) => SequencerNote[];
  metronome: boolean;
  beatsPerBar: number;
}

const STEP_BEATS = 0.25;

/**
 * Notes sorted by start, cached per notes array (patterns are immutable, so an
 * edit makes a new array). The scheduler asks for a few tenths of a beat at a
 * time; with the notes sorted it finds that slice by binary search instead of
 * testing every note in every pattern on every tick.
 */
const sortedCache = new WeakMap<SequencerNote[], SequencerNote[]>();

function sortedByStart(notes: SequencerNote[]): SequencerNote[] {
  let s = sortedCache.get(notes);
  if (!s) {
    s = [...notes].sort((a, b) => a.startBeat - b.startBeat);
    sortedCache.set(notes, s);
  }
  return s;
}

/** First index whose start is >= q (with the same tolerance as `occurrences`). */
function lowerBound(sorted: SequencerNote[], q: number): number {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].startBeat < q - 1e-9) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * Song positions of every note starting in song range [s0, s1) inside a clip
 * — `occurrences` for a whole pattern at once. The clip-relative window is cut
 * into one range per pattern repeat, and each range is looked up by search.
 */
function noteStartsInClip(
  clip: Pick<Clip, 'startBeat' | 'lengthBeats' | 'offsetBeats'>,
  P: number,
  notes: SequencerNote[],
  s0: number,
  s1: number,
  visit: (n: SequencerNote, at: number) => void,
): void {
  if (P <= 0) return;
  const ua = Math.max(0, s0 - clip.startBeat);
  const ub = Math.min(clip.lengthBeats, s1 - clip.startBeat);
  if (ub <= ua) return;
  const off = clip.offsetBeats % P;
  const sorted = sortedByStart(notes);
  // Pattern-time window [ua + off, ub + off), split at every repeat boundary
  for (let rep = Math.floor((ua + off) / P) * P; rep < ub + off - 1e-9; rep += P) {
    const lo = Math.max(ua + off, rep) - rep;
    const hi = Math.min(ub + off, rep + P) - rep;
    for (let i = lowerBound(sorted, lo); i < sorted.length; i++) {
      const q = sorted[i].startBeat;
      if (q >= hi - 1e-9 || q >= P) break;
      if (q < 0) continue;
      visit(sorted[i], clip.startBeat + rep + q - off);
    }
  }
}

/** Every event whose start falls in song range [s0, s1). */
export function eventsInSegment(input: TimelineInput, seg: Segment): TimelineEvent[] {
  const { songStart: s0, songEnd: s1, offset } = seg;
  const out: TimelineEvent[] = [];

  for (const track of input.tracks) {
    for (const clip of track.clips) {
      if (clip.muted) continue;
      if (clip.startBeat >= s1 || clip.startBeat + clip.lengthBeats <= s0) continue;
      const clipEnd = clip.startBeat + clip.lengthBeats;

      if (track.source.type === 'drums') {
        const dp = input.drumPatterns.get(clip.patternId);
        if (!dp) continue;
        const P = dp.stepCount * STEP_BEATS;
        const anySolo = dp.voices.some((v) => v.solo);
        for (const voice of dp.voices) {
          if (voice.muted || (anySolo && !voice.solo)) continue;
          for (let i = 0; i < voice.steps.length && i < dp.stepCount; i++) {
            const step = voice.steps[i];
            if (!step.active) continue;
            for (const at of occurrences(clip, P, i * STEP_BEATS, s0, s1)) {
              out.push({
                kind: 'drum', track, voice, step,
                songBeat: at, monoBeat: at + offset,
                swingBeats: i % 2 === 1 ? dp.swing * STEP_BEATS * 0.5 : 0,
              });
            }
          }
        }
      } else {
        const pattern = input.patterns[clip.patternId];
        if (!pattern) continue;
        noteStartsInClip(clip, pattern.lengthBeats, input.notesFor(track, pattern), s0, s1, (n, at) => {
          out.push({
            kind: 'note', track,
            songBeat: at, monoBeat: at + offset,
            midiNote: n.midiNote, velocity: n.velocity,
            durationBeats: Math.max(0.01, Math.min(n.durationBeats, clipEnd - at)),
          });
        });
      }
    }
  }

  if (input.metronome) {
    for (let b = Math.ceil(s0 - 1e-9); b < s1 - 1e-9; b++) {
      out.push({ kind: 'click', monoBeat: b + offset, accent: b % input.beatsPerBar === 0 });
    }
  }

  return out;
}

/** When an event actually sounds, in mono beats (drum swing delays the hit). */
export function eventTime(e: TimelineEvent): number {
  return e.kind === 'drum' ? e.monoBeat + e.swingBeats : e.monoBeat;
}

/**
 * Every event that starts in mono window [a, b), in time order. Order matters
 * beyond tidiness: a kick's sidechain duck rewrites the duck envelope from its
 * own time onward, so an earlier kick scheduled after a later one would erase it.
 */
export function eventsInWindow(
  input: TimelineInput, a: number, b: number, loop: LoopConfig, engaged: boolean,
): TimelineEvent[] {
  const events = windowSegments(a, b, loop, engaged).flatMap((seg) => eventsInSegment(input, seg));
  return events.sort((x, y) => eventTime(x) - eventTime(y));
}

/** A held note picked up partway through — see `heldNotesAt`. */
export interface ChasedNote extends NoteEvent {
  /** How far into the note playback starts, in beats. */
  intoBeats: number;
}

/**
 * Notes that started before `songBeat` and are still sounding there ("note
 * chase"). Without this, starting playback in the middle of a held chord is
 * silent until the next note begins. Returned events start at `songBeat` with
 * their remaining length; notes with less than `minRemaining` beats left are
 * skipped, since restarting a nearly finished note sounds like a glitch.
 */
export function heldNotesAt(input: TimelineInput, songBeat: number, minRemaining = 0.25): ChasedNote[] {
  const out: ChasedNote[] = [];
  for (const track of input.tracks) {
    if (track.source.type === 'drums') continue;
    for (const clip of track.clips) {
      if (clip.muted) continue;
      const clipEnd = clip.startBeat + clip.lengthBeats;
      if (songBeat <= clip.startBeat || songBeat >= clipEnd) continue;
      const pattern = input.patterns[clip.patternId];
      if (!pattern) continue;
      for (const n of input.notesFor(track, pattern)) {
        // Starts in [songBeat - duration, songBeat): the occurrence that covers songBeat
        const from = Math.max(clip.startBeat, songBeat - n.durationBeats);
        for (const at of occurrences(clip, pattern.lengthBeats, n.startBeat, from, songBeat)) {
          const end = Math.min(at + n.durationBeats, clipEnd);
          const remaining = end - songBeat;
          if (remaining < minRemaining) continue;
          out.push({
            kind: 'note', track,
            songBeat, monoBeat: songBeat,
            midiNote: n.midiNote, velocity: n.velocity,
            durationBeats: remaining,
            intoBeats: songBeat - at,
          });
        }
      }
    }
  }
  return out;
}
