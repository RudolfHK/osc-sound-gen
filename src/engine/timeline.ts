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
        const notes = input.notesFor(track, pattern);
        for (const n of notes) {
          for (const at of occurrences(clip, pattern.lengthBeats, n.startBeat, s0, s1)) {
            out.push({
              kind: 'note', track,
              songBeat: at, monoBeat: at + offset,
              midiNote: n.midiNote, velocity: n.velocity,
              durationBeats: Math.max(0.01, Math.min(n.durationBeats, clipEnd - at)),
            });
          }
        }
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

export function eventsInWindow(
  input: TimelineInput, a: number, b: number, loop: LoopConfig, engaged: boolean,
): TimelineEvent[] {
  return windowSegments(a, b, loop, engaged).flatMap((seg) => eventsInSegment(input, seg));
}
