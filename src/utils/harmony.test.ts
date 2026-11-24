import { describe, it, expect } from 'vitest';
import {
  chordName, parseChord, chordPitchClasses, chordAt, chordSpans, detectKey, pitchHistogram,
  diatonicChords, progressionChords, detectChord, keyName, PROGRESSIONS,
} from './harmony';

const notes = (pitches: number[], dur = 1) => pitches.map((midiNote) => ({ midiNote, durationBeats: dur, velocity: 100 }));

describe('chord symbols', () => {
  it('names chords, with flats when asked and slash bass', () => {
    expect(chordName({ root: 9, quality: 'm7' })).toBe('Am7');
    expect(chordName({ root: 10, quality: 'maj7' }, true)).toBe('B♭maj7');
    expect(chordName({ root: 5, quality: 'maj', bass: 0 })).toBe('F/C');
    expect(chordName({ root: 0, quality: 'maj', bass: 0 })).toBe('C');
  });

  it('parses what people type', () => {
    expect(parseChord('Am7')).toEqual({ root: 9, quality: 'm7' });
    expect(parseChord('Bb/D')).toEqual({ root: 10, quality: 'maj', bass: 2 });
    expect(parseChord('F#m')).toEqual({ root: 6, quality: 'min' });
    expect(parseChord('Cmaj9')).toEqual({ root: 0, quality: 'maj9' });
    expect(parseChord('Gsus')).toEqual({ root: 7, quality: 'sus4' });
    expect(parseChord('E♭°7')).toEqual({ root: 3, quality: 'dim7' });
    expect(parseChord('H7')).toBeNull();
    expect(parseChord('Cxyz')).toBeNull();
  });

  it('knows its notes', () => {
    expect([...chordPitchClasses({ root: 2, quality: 'm7' })].sort((a, b) => a - b)).toEqual([0, 2, 5, 9]);
  });

  it('finds the chord at a beat and how long each lasts', () => {
    const chords = [{ beat: 0, n: 'a' }, { beat: 4, n: 'b' }, { beat: 12, n: 'c' }];
    expect(chordAt(chords, 3.9)?.n).toBe('a');
    expect(chordAt(chords, 4)?.n).toBe('b');
    expect(chordAt([{ beat: 2 }], 1)).toBeNull();
    expect(chordSpans(chords, 16).map((c) => c.endBeat)).toEqual([4, 12, 16]);
  });
});

describe('keys', () => {
  it('detects C major and A minor from their scales and cadences', () => {
    const cMajor = pitchHistogram(notes([60, 62, 64, 65, 67, 69, 71, 72, 60, 64, 67, 67, 72], 1));
    expect(detectKey(cMajor)).toMatchObject({ tonic: 0, mode: 'major' });
    const aMinor = pitchHistogram([...notes([57, 60, 64, 57, 60, 64], 2), ...notes([59, 62, 64, 68], 0.5), ...notes([57, 69], 4)]);
    expect(detectKey(aMinor)).toMatchObject({ tonic: 9, mode: 'minor' });
    expect(detectKey(new Array(12).fill(0))).toBeNull();
  });

  it('lists diatonic chords and spells progressions in any key', () => {
    const g = diatonicChords({ tonic: 7, mode: 'major' });
    expect(g.map((d) => chordName(d.chord))).toEqual(['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F♯dim']);
    const pop = PROGRESSIONS.find((p) => p.numerals.join() === 'I,V,vi,IV')!;
    expect(progressionChords({ tonic: 0, mode: 'major' }, pop.numerals, pop.mode).map((c) => chordName(c))).toEqual(['C', 'G', 'Am', 'F']);
    // A minor-mode progression in a major key uses the relative minor
    const epic = PROGRESSIONS.find((p) => p.name.startsWith('Epic'))!;
    expect(progressionChords({ tonic: 0, mode: 'major' }, epic.numerals, epic.mode).map((c) => chordName(c))).toEqual(['Am', 'F', 'C', 'G']);
    expect(keyName({ tonic: 3, mode: 'major' })).toBe('E♭ major');
  });
});

describe('chord detection', () => {
  it('recognises triads and sevenths from voicings and arpeggios', () => {
    expect(detectChord(notes([57, 60, 64]))).toEqual({ root: 9, quality: 'min' });
    expect(detectChord(notes([43, 59, 62, 65], 1))).toEqual({ root: 7, quality: '7' });
    expect(detectChord(notes([48, 64, 67, 71, 72]))).toEqual({ root: 0, quality: 'maj7' });
    // An inversion: the bass helps but the chord tones decide
    expect(detectChord(notes([52, 60, 67, 72]))).toEqual({ root: 0, quality: 'maj' });
    expect(detectChord(notes([60]))).toBeNull();
  });
});
