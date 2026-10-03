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

  // Parts that loop a shared chord cycle must enter on the right chord. The
  // arp clip starts two bars into the song, so it has to start two bars into
  // its pattern as well — this is the bug the clip offset exists to prevent.
  it('midnight-drive: arp and pad play the same chord in every bar', () => {
    const p = parseProject(JSON.parse(readFileSync(join(DIR, 'midnight-drive.oscproject'), 'utf8')));
    const input = {
      tracks: p.doc.tracks,
      patterns: p.doc.patterns,
      drumPatterns: new Map<string, DrumPattern>(p.drumPatterns.map((d) => [d.id, d])),
      notesFor: (_t: unknown, pat: { notes: { midiNote: number; startBeat: number; durationBeats: number; velocity: number; id: string }[] }) => pat.notes,
      metronome: false,
      beatsPerBar: 4,
    };
    const arp = p.doc.tracks.find((t) => t.name === 'Arp')!;
    const pad = p.doc.tracks.find((t) => t.name === 'Pad')!;
    const firstArpBar = arp.clips[0].startBeat / 4;

    for (let bar = firstArpBar; bar < 16; bar++) {
      const ev = eventsInWindow(input, bar * 4, bar * 4 + 0.01, { enabled: false, start: 0, end: 0 }, false);
      const pcs = (trackId: string) => new Set(
        ev.filter((e) => e.kind === 'note' && e.track.id === trackId)
          .map((e) => (e.kind === 'note' ? e.midiNote % 12 : -1)),
      );
      const a = pcs(arp.id);
      const b = pcs(pad.id);
      expect(a.size, `bar ${bar + 1}: arp silent`).toBeGreaterThan(0);
      expect([...a].sort(), `bar ${bar + 1}: arp and pad disagree`).toEqual([...b].sort());
    }
  });
});
