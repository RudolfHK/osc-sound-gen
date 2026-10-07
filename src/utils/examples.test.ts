import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseProject } from './project';
import { eventsInWindow } from '../engine/timeline';
import type { DrumPattern } from '../store/drumStore';

const DIR = join(__dirname, '../../examples');
const files = readdirSync(DIR).filter((f) => f.endsWith('.oscproject'));

describe('bundled examples', () => {
  it('ships some examples', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} loads cleanly as a v2 project`, () => {
      const raw = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
      expect(raw.format).toBe('osc-project');
      const p = parseProject(raw);
      expect(p.warnings).toEqual([]);
      expect(p.doc.tracks.length).toBeGreaterThan(0);
      expect(p.doc.markers.length).toBeGreaterThan(0);
      // Every note track has a preset, not a guessed one
      for (const t of p.doc.tracks) {
        expect(t.source.type === 'preset' || t.source.type === 'drums').toBe(true);
        expect(t.clips.length).toBeGreaterThan(0);
      }
    });
  }

  // Parts that loop a shared chord cycle must enter on the right chord. A clip
  // that starts partway into the cycle has to start the same distance into its
  // pattern — this is the bug the clip offset exists to prevent.
  const chordCheck = (file: string, chordTracks: string[]) => {
    const p = parseProject(JSON.parse(readFileSync(join(DIR, file), 'utf8')));
    const input = {
      tracks: p.doc.tracks,
      patterns: p.doc.patterns,
      drumPatterns: new Map<string, DrumPattern>(p.drumPatterns.map((d) => [d.id, d])),
      notesFor: (_t: unknown, pat: { notes: { midiNote: number; startBeat: number; durationBeats: number; velocity: number; id: string }[] }) => pat.notes,
      metronome: false,
      beatsPerBar: 4,
    };
    const byName = (n: string) => p.doc.tracks.find((t) => t.name === n)!;
    const pad = byName('Pad');
    const arp = byName('Arp');
    const firstArpBar = arp.clips[0].startBeat / 4;
    let checked = 0;

    for (let bar = 0; bar < p.songLengthBars; bar++) {
      const ev = eventsInWindow(input, bar * 4, bar * 4 + 0.01, { enabled: false, start: 0, end: 0 }, false);
      const pcs = (trackId: string) => new Set(
        ev.filter((e) => e.kind === 'note' && e.track.id === trackId)
          .map((e) => (e.kind === 'note' ? e.midiNote % 12 : -1)),
      );
      const padPcs = pcs(pad.id);
      if (bar >= firstArpBar && padPcs.size > 0 && bar < firstArpBar + 64) {
        expect(pcs(arp.id).size, `${file} bar ${bar + 1}: arp silent`).toBeGreaterThan(0);
      }
      if (padPcs.size === 0) continue;
      for (const name of chordTracks) {
        const other = pcs(byName(name).id);
        for (const pc of other) {
          expect(padPcs.has(pc), `${file} bar ${bar + 1}: ${name} plays outside the pad's chord`).toBe(true);
        }
        if (other.size) checked++;
      }
    }
    return checked;
  };

  it('midnight-drive: every chord part plays the pad\'s chord in every bar', () => {
    expect(chordCheck('midnight-drive.oscproject', ['Arp', 'Sub'])).toBeGreaterThan(20);
  });

  it('midnight-drive-extended: every chord part agrees with the pad, bridge included', () => {
    expect(chordCheck('midnight-drive-extended.oscproject', ['Arp', 'Sub', 'Keys', 'Choir'])).toBeGreaterThan(150);
  });
});
