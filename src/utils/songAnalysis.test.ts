import { describe, it, expect } from 'vitest';
import { notesInRange, detectSongKey, detectChordsInRange } from './songAnalysis';
import { makeTrack, makeClip, makePattern, type SequencerNote } from './music';
import { chordName } from './harmony';

const note = (midiNote: number, startBeat: number, durationBeats: number): SequencerNote =>
  ({ id: `${midiNote}-${startBeat}`, midiNote, startBeat, durationBeats, velocity: 100 });

/** A pad playing Am | F | C | G, one chord per bar, in a 16-beat pattern looped over 32 beats. */
function song() {
  const pad = makeTrack({ name: 'Pad', source: { type: 'preset', presetId: 'pad-warm' } });
  const p = makePattern('Pad 1', 16);
  const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
  p.notes = chords.flatMap((c, bar) => c.map((m) => note(m, bar * 4, 4)));
  pad.clips = [makeClip(p.id, 0, 32)];
  const drums = makeTrack({ name: 'Drums', source: { type: 'drums' } });
  return { tracks: [pad, drums], patterns: { [p.id]: p } };
}

describe('song analysis', () => {
  it('finds the notes sounding in a range, looping the pattern and clipping durations', () => {
    const { tracks, patterns } = song();
    const bar5 = notesInRange(tracks, patterns, 16, 20);
    expect(bar5.map((n) => n.midiNote).sort()).toEqual([57, 60, 64]);
    const half = notesInRange(tracks, patterns, 2, 6);
    expect(half.every((n) => n.durationBeats === 2)).toBe(true);
    expect(half).toHaveLength(6);
  });

  it('detects the key and the chords, bar by bar', () => {
    const { tracks, patterns } = song();
    expect(detectSongKey(tracks, patterns, 32)).toMatchObject({ tonic: 9, mode: 'minor' });
    const chords = detectChordsInRange(tracks, patterns, 0, 32, 4);
    expect(chords.map((c) => [c.beat, chordName(c)])).toEqual([
      [0, 'Am'], [4, 'F'], [8, 'C'], [12, 'G'], [16, 'Am'], [20, 'F'], [24, 'C'], [28, 'G'],
    ]);
  });
});

describe('key detection on the bundled examples', () => {
  // Keys as documented in examples/README.md
  const expected: [string, number, 'major' | 'minor'][] = [
    ['midnight-drive.oscproject', 9, 'minor'],
    ['midnight-drive-extended.oscproject', 9, 'minor'],
    ['phonk-neon-drift.oscproject', 6, 'minor'],
    ['phonk-memphis-fog.oscproject', 0, 'minor'],
    ['deep-house-velvet-hours.oscproject', 9, 'minor'],
    ['deep-house-low-tide.oscproject', 5, 'minor'],
    ['minecraft-style-morning-meadow.oscproject', 2, 'major'],
    ['minecraft-style-snowfall.oscproject', 7, 'major'],
    ['minecraft-wet-hands.oscproject', 0, 'major'],
    ['minecraft-sweden.oscproject', 9, 'minor'],
  ];
  for (const [file, tonic, mode] of expected) {
    it(file, async () => {
      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { parseProject } = await import('./project');
      const p = parseProject(JSON.parse(readFileSync(join(__dirname, '../../examples', file), 'utf8')));
      const key = detectSongKey(p.doc.tracks, p.doc.patterns, p.songLengthBars * p.beatsPerBar, p.beatsPerBar);
      expect(key).toMatchObject({ tonic, mode });
    });
  }
});
