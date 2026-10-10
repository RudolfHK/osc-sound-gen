import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseProject } from './project';
import { makeTemplate, TEMPLATE_LOOP_BARS } from './templates';

const DIR = join(__dirname, '../../examples');
const manifest = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')) as {
  examples: { file: string; title: string; genre: string; seconds: number; description: string }[];
  templates: { id: string; title: string; from: string }[];
};
const load = (file: string) => parseProject(JSON.parse(readFileSync(join(DIR, file), 'utf8')));

describe('examples manifest', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.oscproject'));

  it('lists every example file, and only files that exist', () => {
    expect(manifest.examples.map((e) => e.file).sort()).toEqual([...files].sort());
  });

  it('gives each example a title, genre, description and its real length', () => {
    for (const e of manifest.examples) {
      expect(e.title, e.file).toBeTruthy();
      expect(e.genre, e.file).toBeTruthy();
      expect(e.description, e.file).toBeTruthy();
      const p = load(e.file);
      const seconds = p.songLengthBars * p.beatsPerBar * 60 / p.bpm;
      expect(Math.abs(seconds - e.seconds), `${e.file}: ${seconds.toFixed(1)} s`).toBeLessThan(1);
    }
  });
});

describe('templates', () => {
  for (const t of manifest.templates) {
    it(`${t.title}: the example's sounds and beat, no notes`, () => {
      const source = load(t.from);
      const tpl = makeTemplate(source, t.title);
      // Same tracks and sounds, same tempo and effects
      expect(tpl.doc.tracks.map((x) => x.source)).toEqual(source.doc.tracks.map((x) => x.source));
      expect(tpl.bpm).toBe(source.bpm);
      expect(tpl.effects).toEqual(source.effects);
      // No notes, no automation, no sections
      expect(Object.keys(tpl.doc.patterns)).toHaveLength(0);
      expect(tpl.doc.markers).toHaveLength(0);
      for (const tr of tpl.doc.tracks) {
        expect(tr.lanes).toHaveLength(0);
        if (tr.source.type !== 'drums') expect(tr.clips).toHaveLength(0);
      }
      // The beat loops from bar 1, using one of the example's own drum patterns
      const drumClips = tpl.doc.tracks.flatMap((x) => (x.source.type === 'drums' ? x.clips : []));
      if (source.doc.tracks.some((x) => x.source.type === 'drums' && x.clips.length)) {
        expect(drumClips).toHaveLength(1);
        expect(drumClips[0].startBeat).toBe(0);
        expect(drumClips[0].lengthBeats).toBe(TEMPLATE_LOOP_BARS * source.beatsPerBar);
        expect(source.drumPatterns.some((d) => d.id === drumClips[0].patternId)).toBe(true);
        expect(tpl.loop).toEqual({ enabled: true, startBeat: 0, endBeat: TEMPLATE_LOOP_BARS * source.beatsPerBar });
      }
    });
  }
});
