import { describe, it, expect } from 'vitest';
import {
  windowSegments, monoToSong, loopEngaged, occurrences, eventsInWindow, heldNotesAt, eventTime,
  type LoopConfig, type TimelineInput, type TimelineEvent,
} from './timeline';
import { makeTrack, makePattern, makeClip, type SequencerNote } from '../utils/music';
import type { DrumPattern } from '../store/drumStore';

const loop: LoopConfig = { enabled: true, start: 4, end: 8 };

describe('loop mapping', () => {
  it('plays straight up to the loop end, then wraps', () => {
    expect(monoToSong(2, loop, true)).toBe(2);
    expect(monoToSong(7.5, loop, true)).toBe(7.5);
    expect(monoToSong(8, loop, true)).toBe(4);
    expect(monoToSong(13, loop, true)).toBe(5);
  });

  it('does not engage when playback starts after the loop', () => {
    expect(loopEngaged(loop, 9)).toBe(false);
    expect(loopEngaged(loop, 0)).toBe(true);
    expect(loopEngaged({ ...loop, enabled: false }, 0)).toBe(false);
  });

  it('splits a window at the wrap and covers it exactly', () => {
    const segs = windowSegments(7, 9, loop, true);
    expect(segs).toEqual([
      { songStart: 7, songEnd: 8, offset: 0 },
      { songStart: 4, songEnd: 5, offset: 4 },
    ]);
    const covered = segs.reduce((s, x) => s + (x.songEnd - x.songStart), 0);
    expect(covered).toBeCloseTo(2);
  });
});

describe('clip occurrences', () => {
  const clip = { startBeat: 8, lengthBeats: 8, offsetBeats: 0 };

  it('repeats a short pattern across a longer clip', () => {
    expect(occurrences(clip, 2, 0.5, 0, 100)).toEqual([8.5, 10.5, 12.5, 14.5]);
  });

  it('respects the half-open window', () => {
    expect(occurrences(clip, 2, 0, 10, 12)).toEqual([10]);
    expect(occurrences(clip, 2, 0, 10.0001, 12)).toEqual([]);
  });

  it('starts mid-pattern when the left edge was trimmed', () => {
    // offset 1 into a 2-beat pattern: q=1 now plays at the very start
    expect(occurrences({ ...clip, offsetBeats: 1 }, 2, 1, 0, 12)).toEqual([8, 10]);
  });

  it('ignores notes beyond the pattern loop length', () => {
    expect(occurrences(clip, 2, 3, 0, 100)).toEqual([]);
  });
});

// ─── Event collection ─────────────────────────────────────────────────────────

function buildInput(metronome = false): TimelineInput {
  const notes: SequencerNote[] = [
    { id: 'a', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 },
    { id: 'b', midiNote: 64, startBeat: 1.5, durationBeats: 3, velocity: 80 },
  ];
  const pat = makePattern('P', 2, notes);
  const keys = makeTrack({ name: 'Keys', source: { type: 'preset', presetId: 'keys-epiano' } });
  keys.clips = [makeClip(pat.id, 0, 6), makeClip(pat.id, 8, 4)];

  const drumPat: DrumPattern = {
    id: 'dp', name: 'D', genre: 'x', stepCount: 16, swing: 0.4,
    voices: [
      { id: 'kick', name: 'K', color: '', volume: 1, pan: 0, tone: 0.5, pitch: 0, decay: 1, muted: false, solo: false,
        steps: Array.from({ length: 16 }, (_, i) => ({ active: i % 4 === 0, velocity: 100, pitch: 0, decay: 1 })) },
      { id: 'hihat-c', name: 'H', color: '', volume: 1, pan: 0, tone: 0.5, pitch: 0, decay: 1, muted: true, solo: false,
        steps: Array.from({ length: 16 }, () => ({ active: true, velocity: 100, pitch: 0, decay: 1 })) },
      { id: 'snare', name: 'S', color: '', volume: 1, pan: 0, tone: 0.5, pitch: 0, decay: 1, muted: false, solo: false,
        steps: Array.from({ length: 16 }, (_, i) => ({ active: i === 5, velocity: 100, pitch: 0, decay: 1 })) },
    ],
  };
  const drums = makeTrack({ name: 'Drums', source: { type: 'drums' } });
  drums.clips = [makeClip('dp', 0, 8)];

  return {
    tracks: [keys, drums],
    patterns: { [pat.id]: pat },
    drumPatterns: new Map([['dp', drumPat]]),
    notesFor: (_t, p) => p.notes,
    metronome,
    beatsPerBar: 4,
  };
}

const key = (e: TimelineEvent) =>
  e.kind === 'click' ? `c@${e.monoBeat.toFixed(4)}`
    : e.kind === 'note' ? `n${e.midiNote}@${e.monoBeat.toFixed(4)}`
      : `d${e.voice.id}@${e.monoBeat.toFixed(4)}`;

describe('eventsInWindow', () => {
  it('finds note repeats and truncates notes at the clip end', () => {
    const ev = eventsInWindow(buildInput(), 0, 6, { enabled: false, start: 0, end: 0 }, false)
      .filter((e) => e.kind === 'note');
    expect(ev.map((e) => e.songBeat)).toEqual([0, 1.5, 2, 3.5, 4, 5.5]);
    const last = ev.find((e) => e.songBeat === 5.5)!;
    // A 3-beat note starting at 5.5 in a clip ending at 6 sounds for half a beat
    expect(last.kind === 'note' && last.durationBeats).toBeCloseTo(0.5);
  });

  it('skips muted drum voices and applies swing to odd steps only', () => {
    const ev = eventsInWindow(buildInput(), 0, 4, { enabled: false, start: 0, end: 0 }, false)
      .filter((e) => e.kind === 'drum');
    expect(ev.some((e) => e.kind === 'drum' && e.voice.id === 'hihat-c')).toBe(false);
    const kicks = ev.filter((e) => e.kind === 'drum' && e.voice.id === 'kick');
    expect(kicks.map((e) => e.songBeat)).toEqual([0, 1, 2, 3]);
    expect(kicks.every((e) => e.kind === 'drum' && e.swingBeats === 0)).toBe(true);
    const snare = ev.find((e) => e.kind === 'drum' && e.voice.id === 'snare')!;
    expect(snare.kind === 'drum' && snare.swingBeats).toBeCloseTo(0.4 * 0.25 * 0.5);
  });

  it('returns events in the order they sound, swing included', () => {
    // A kick's sidechain duck rewrites the envelope from its own time onward,
    // so an earlier event emitted after a later one would erase it
    const ev = eventsInWindow(buildInput(true), 0, 8, { enabled: true, start: 0, end: 4 }, true);
    const times = ev.map(eventTime);
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });

  it('emits accented metronome clicks on the bar', () => {
    const clicks = eventsInWindow(buildInput(true), 3, 5.5, { enabled: false, start: 0, end: 0 }, false)
      .filter((e) => e.kind === 'click');
    expect(clicks.map((c) => [c.monoBeat, c.kind === 'click' && c.accent])).toEqual([[3, false], [4, true], [5, false]]);
  });

  // The invariant the scheduler relies on: chopping time into many small
  // windows yields exactly the events of one big window — no duplicates, no gaps.
  for (const [label, lp, engaged] of [
    ['without a loop', { enabled: false, start: 0, end: 0 }, false],
    ['with a loop', { enabled: true, start: 2, end: 9 }, true],
  ] as const) {
    it(`small windows add up to one big window ${label}`, () => {
      const input = buildInput(true);
      const whole = eventsInWindow(input, 0, 40, lp, engaged).map(key).sort();
      const pieces: string[] = [];
      // Irregular step sizes, like a real scheduler running on setTimeout
      let a = 0;
      const steps = [0.13, 0.27, 0.05, 0.5, 0.31, 0.24];
      for (let i = 0; a < 40; i++) {
        const b = Math.min(40, a + steps[i % steps.length]);
        pieces.push(...eventsInWindow(input, a, b, lp, engaged).map(key));
        a = b;
      }
      expect(pieces.sort()).toEqual(whole);
      expect(new Set(pieces).size).toBe(pieces.length);
    });
  }
});

describe('note chase', () => {
  it('finds notes still held at the start position, with their remaining length', () => {
    const held = heldNotesAt(buildInput(), 2.5);
    const byNote = Object.fromEntries(held.map((e) => [e.midiNote, e]));
    // 60 started at 2 (1 beat long), 64 started at 1.5 (3 beats long)
    expect(Object.keys(byNote).sort()).toEqual(['60', '64']);
    expect(byNote[60].durationBeats).toBeCloseTo(0.5);
    expect(byNote[60].intoBeats).toBeCloseTo(0.5);
    expect(byNote[64].durationBeats).toBeCloseTo(2);
    expect(byNote[64].intoBeats).toBeCloseTo(1);
    expect(held.every((e) => e.songBeat === 2.5 && e.monoBeat === 2.5)).toBe(true);
  });

  it('leaves notes starting exactly at the position to the normal scheduler', () => {
    const held = heldNotesAt(buildInput(), 2);
    expect(held.map((e) => e.midiNote)).toEqual([64]);
  });

  it('respects the clip end and skips nearly finished notes', () => {
    // 64 is three beats long in a two-beat pattern, so the repeats from 3.5
    // and 5.5 overlap there — and both are cut at the clip end (6)
    expect(heldNotesAt(buildInput(), 5.75).map((e) => [e.intoBeats, e.durationBeats])).toEqual([[2.25, 0.25], [0.25, 0.25]]);
    expect(heldNotesAt(buildInput(), 5.8)).toEqual([]);
    // Outside any clip
    expect(heldNotesAt(buildInput(), 7)).toEqual([]);
  });
});

describe('indexed note lookup', () => {
  // Deterministic pseudo-random numbers so a failure is reproducible
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

  it('finds exactly the notes the per-note search finds', () => {
    for (let trial = 0; trial < 300; trial++) {
      const P = [1, 2, 3, 4, 4.5, 8][Math.floor(rnd() * 6)];
      const notes: SequencerNote[] = Array.from({ length: 1 + Math.floor(rnd() * 12) }, (_, i) => ({
        id: `n${i}`,
        midiNote: 60 + i,
        // Some notes sit on the grid, some off it, some past the pattern end
        startBeat: rnd() < 0.5 ? Math.floor(rnd() * P * 4) / 4 : rnd() * P * 1.2,
        durationBeats: 0.25 + rnd() * 2,
        velocity: 100,
      }));
      const pat = makePattern('R', P, notes);
      const track = makeTrack({ name: 'R', source: { type: 'preset', presetId: 'keys-epiano' } });
      const clip = { ...makeClip(pat.id, Math.floor(rnd() * 8), 0.5 + rnd() * 20), offsetBeats: rnd() * P * 2 };
      track.clips = [clip];
      const input: TimelineInput = {
        tracks: [track], patterns: { [pat.id]: pat }, drumPatterns: new Map(),
        notesFor: (_t, p) => p.notes, metronome: false, beatsPerBar: 4,
      };
      const a = rnd() * 30;
      const b = a + rnd() * 3;
      const got = eventsInWindow(input, a, b, { enabled: false, start: 0, end: 0 }, false)
        .map((e) => (e.kind === 'note' ? `${e.midiNote}@${e.songBeat.toFixed(6)}` : '')).sort();
      const expected = notes.flatMap((n) => occurrences(clip, P, n.startBeat, a, b)
        .map((at) => `${n.midiNote}@${at.toFixed(6)}`)).sort();
      expect(got, `trial ${trial}`).toEqual(expected);
    }
  });
});
