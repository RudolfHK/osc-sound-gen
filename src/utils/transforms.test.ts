import { describe, it, expect } from 'vitest';
import { transformNotes, transformLabel } from './transforms';
import { reducer, makeInitialAppState } from '../store/appStore';
import type { SequencerNote } from './music';

const n = (id: string, midiNote: number, startBeat: number, durationBeats = 1, velocity = 100): SequencerNote =>
  ({ id, midiNote, startBeat, durationBeats, velocity });
const melody = [n('a', 60, 0), n('b', 64, 1), n('c', 67, 2, 2)];

describe('note transforms', () => {
  it('transposes, clamped to the MIDI range', () => {
    expect(transformNotes(melody, { op: 'transpose', semitones: 12 }, { lengthBeats: 4 }).map((x) => x.midiNote)).toEqual([72, 76, 79]);
    expect(transformNotes([n('x', 125, 0)], { op: 'transpose', semitones: 12 }, { lengthBeats: 4 })[0].midiNote).toBe(127);
  });

  it('reverses a whole pattern over its loop, and a selection over its own span', () => {
    const r = transformNotes(melody, { op: 'reverse' }, { lengthBeats: 4 });
    expect(r.map((x) => [x.id, x.startBeat])).toEqual([['a', 3], ['b', 2], ['c', 0]]);
    const sel = transformNotes(melody, { op: 'reverse' }, { lengthBeats: 4, only: new Set(['a', 'b']) });
    expect(sel.map((x) => [x.id, x.startBeat])).toEqual([['a', 1], ['b', 0], ['c', 2]]);
  });

  it('inverts pitches around the middle of their range', () => {
    expect(transformNotes(melody, { op: 'invert' }, { lengthBeats: 4 }).map((x) => x.midiNote)).toEqual([67, 63, 60]);
  });

  it('changes speed from the pattern start (or the selection start)', () => {
    const half = transformNotes(melody, { op: 'stretch', factor: 2 }, { lengthBeats: 4 });
    expect(half.map((x) => [x.startBeat, x.durationBeats])).toEqual([[0, 2], [2, 2], [4, 4]]);
    const dbl = transformNotes(melody, { op: 'stretch', factor: 0.5 }, { lengthBeats: 4, only: new Set(['b', 'c']) });
    expect(dbl.map((x) => x.startBeat)).toEqual([0, 1, 1.5]);
  });

  it('legato holds each note to the next, chords together', () => {
    const chordy = [n('a', 60, 0, 0.25), n('b', 64, 0, 0.25), n('c', 67, 2, 0.25)];
    expect(transformNotes(chordy, { op: 'legato' }, { lengthBeats: 4 }).map((x) => x.durationBeats)).toEqual([2, 2, 2]);
  });

  it('humanizes repeatably and only a little', () => {
    const a = transformNotes(melody, { op: 'humanize', amount: 1, seed: 3 }, { lengthBeats: 4 });
    expect(transformNotes(melody, { op: 'humanize', amount: 1, seed: 3 }, { lengthBeats: 4 })).toEqual(a);
    a.forEach((x, i) => {
      expect(Math.abs(x.velocity - melody[i].velocity)).toBeLessThanOrEqual(20);
      expect(Math.abs(x.startBeat - melody[i].startBeat)).toBeLessThanOrEqual(0.0625);
      expect(x.startBeat).toBeGreaterThanOrEqual(0);
    });
  });

  it('keeps ids and names the undo step', () => {
    expect(transformNotes(melody, { op: 'invert' }, { lengthBeats: 4 }).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(transformLabel({ op: 'stretch', factor: 2 })).toBe('Half speed');
    expect(transformLabel({ op: 'transpose', semitones: -12 })).toBe('Transpose -12');
  });
});

describe('transforming a clip', () => {
  it('half speed doubles the pattern loop and the clip', () => {
    let s = makeInitialAppState();
    const keys = s.sequencer.tracks.find((t) => t.name === 'Keys')!.id;
    s = reducer(s, { type: 'CLIP_ADD', trackId: keys, startBeat: 0, lengthBeats: 4 });
    const clip = s.sequencer.tracks.find((t) => t.id === keys)!.clips[0];
    s = reducer(s, { type: 'SEQ_ADD_NOTE', patternId: clip.patternId, note: n('x', 60, 3, 1) });
    s = reducer(s, { type: 'PATTERN_TRANSFORM', patternId: clip.patternId, transform: { op: 'stretch', factor: 2 }, clipId: clip.id });
    expect(s.sequencer.patterns[clip.patternId].lengthBeats).toBe(8);
    expect(s.sequencer.patterns[clip.patternId].notes[0].startBeat).toBe(6);
    expect(s.sequencer.tracks.find((t) => t.id === keys)!.clips[0].lengthBeats).toBe(8);
  });
});
