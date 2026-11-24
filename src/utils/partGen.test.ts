import { describe, it, expect } from 'vitest';
import { PART_STYLES, chordSegments, generatePart, splitPart, voiceChord, type PartNote } from './partGen';
import { chordPitchClasses, type ChordMark } from './harmony';

type C = Pick<ChordMark, 'beat' | 'root' | 'quality' | 'bass'>;
// Am – F – C – G, a bar each, then held G
const chords: C[] = [
  { beat: 0, root: 9, quality: 'min' },
  { beat: 4, root: 5, quality: 'maj' },
  { beat: 8, root: 0, quality: 'maj' },
  { beat: 12, root: 7, quality: 'maj' },
];
const req = (styleId: string, extra: Partial<Parameters<typeof generatePart>[1]> = {}) =>
  ({ styleId, from: 0, to: 16, beatsPerBar: 4, seed: 3, ...extra });
const chordAtBeat = (t: number) => [...chords].reverse().find((c) => c.beat <= t)!;
const inChord = (n: PartNote) => chordPitchClasses(chordAtBeat(n.startBeat)).has(n.midiNote % 12);

describe('chordSegments', () => {
  it('clips chords to the range, with a chord held into it', () => {
    const segs = chordSegments(chords, 6, 14);
    expect(segs.map((s) => [s.root, s.start, s.end])).toEqual([[5, 6, 8], [0, 8, 12], [7, 12, 14]]);
  });
});

describe('generatePart', () => {
  it('every style writes notes from the chord, inside the range, in order', () => {
    for (const style of PART_STYLES) {
      const notes = generatePart(chords, req(style.id));
      expect(notes.length, style.id).toBeGreaterThan(0);
      for (const n of notes) {
        expect(n.startBeat, style.id).toBeGreaterThanOrEqual(0);
        expect(n.startBeat + n.durationBeats, style.id).toBeLessThanOrEqual(16 + 1e-6);
        expect(n.velocity, style.id).toBeGreaterThan(0);
        expect(n.velocity, style.id).toBeLessThanOrEqual(127);
      }
      expect(notes.map((n) => n.startBeat), style.id).toEqual([...notes.map((n) => n.startBeat)].sort((a, b) => a - b));
      // Walking bass leans into the next chord with passing notes; everything else is chord tones
      if (style.id !== 'bass-walk') expect(notes.every(inChord), style.id).toBe(true);
    }
  });

  it('is the same for the same seed, and a different seed varies it', () => {
    expect(generatePart(chords, req('arp-random'))).toEqual(generatePart(chords, req('arp-random')));
    expect(generatePart(chords, req('arp-random', { seed: 4 }))).not.toEqual(generatePart(chords, req('arp-random')));
  });

  it('keeps bass in the bass register and plays the slash bass', () => {
    const notes = generatePart([{ beat: 0, root: 0, quality: 'maj', bass: 4 }], req('bass-roots', { to: 8 }));
    expect(notes.map((n) => n.midiNote)).toEqual([40, 40]); // E2 under C/E, restruck each bar
    expect(notes.every((n) => n.midiNote >= 33 && n.midiNote < 45)).toBe(true);
    const up = generatePart([{ beat: 0, root: 0, quality: 'maj', bass: 4 }], req('bass-roots', { to: 4, octave: 1 }));
    expect(up[0].midiNote).toBe(52);
  });

  it('puts rhythms on the bar grid, not on the chord changes', () => {
    // A chord change on beat 2.5 must not shift the offbeat bass
    const notes = generatePart([{ beat: 0, root: 0, quality: 'maj' }, { beat: 2.5, root: 7, quality: 'maj' }], req('bass-offbeat', { to: 4 }));
    expect(notes.map((n) => n.startBeat)).toEqual([0.5, 1.5, 2.5, 3.5]);
    // …and a note is cut where its chord ends
    expect(notes[1].durationBeats).toBeLessThanOrEqual(1);
  });

  it('writes nothing before the first chord', () => {
    const notes = generatePart([{ beat: 8, root: 0, quality: 'maj' }], req('bass-pulse'));
    expect(Math.min(...notes.map((n) => n.startBeat))).toBe(8);
    expect(generatePart([], req('pad-held'))).toEqual([]);
  });

  it('fits a 4/4 figure into a 3/4 bar', () => {
    const notes = generatePart(chords, req('bass-groove', { beatsPerBar: 3, to: 6 }));
    expect(notes.every((n) => n.startBeat % 3 < 3)).toBe(true);
    expect(notes.some((n) => n.startBeat >= 3)).toBe(true);
  });

  it('walking bass approaches each new chord by a semitone', () => {
    const notes = generatePart(chords, req('bass-walk'));
    for (const change of [4, 8, 12]) {
      const before = notes.find((n) => n.startBeat === change - 1)!;
      const on = notes.find((n) => n.startBeat === change)!;
      expect(Math.abs(before.midiNote - on.midiNote), `into beat ${change}`).toBe(1);
    }
  });

  it('arpeggios climb, and restart on each chord', () => {
    const notes = generatePart(chords, req('arp-up', { to: 4 }));
    expect(notes).toHaveLength(16);
    expect(notes[1].midiNote).toBeGreaterThan(notes[0].midiNote);
    expect(notes[4].midiNote).toBe(notes[0].midiNote);
  });
});

describe('voice leading', () => {
  const movement = (a: number[], b: number[]) => a.reduce((s, m, i) => s + Math.abs(m - b[i]), 0);

  it('moves pads by small steps between chords', () => {
    const am = voiceChord({ beat: 0, root: 9, quality: 'min' }, null, 52, 79, 64);
    const f = voiceChord({ beat: 4, root: 5, quality: 'maj' }, am, 52, 79, 64);
    // Am → F shares A and C: the voicing keeps them and moves the rest a step
    expect(movement(am, f)).toBeLessThanOrEqual(4);
    expect(am.every((m) => m >= 52 && m <= 79)).toBe(true);
  });

  it('held pads stay in their register over a long progression', () => {
    const long = Array.from({ length: 16 }, (_, i) => chords[i % 4]).map((c, i) => ({ ...c, beat: i * 4 }));
    const notes = generatePart(long, req('pad-held', { to: 64 }));
    const lows = new Set(notes.map((n) => n.midiNote));
    expect(Math.max(...lows) - Math.min(...lows)).toBeLessThanOrEqual(24);
  });
});

describe('splitPart', () => {
  it('cuts a part into clips in their own time, shortening notes at the edge', () => {
    const notes = generatePart(chords, req('pad-held'));
    const [a, b] = splitPart(notes, [{ start: 0, end: 6 }, { start: 6, end: 16 }]);
    expect(a.every((n) => n.startBeat < 6 && n.startBeat + n.durationBeats <= 6 + 1e-9)).toBe(true);
    expect(b.every((n) => n.startBeat >= 0 && n.startBeat < 10)).toBe(true);
    // The F chord starts at 4 and is cut at 6, so the second clip has no F
    expect(b.some((n) => n.startBeat === 2)).toBe(true); // C at song beat 8
  });
});
