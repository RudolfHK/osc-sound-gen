import { describe, it, expect } from 'vitest';
import { INSTRUMENT_PRESETS, CATEGORIES, PRESETS_BY_ID } from './instruments';

describe('instrument library', () => {
  it('has unique ids and every preset in a known category', () => {
    expect(PRESETS_BY_ID.size).toBe(INSTRUMENT_PRESETS.length);
    for (const p of INSTRUMENT_PRESETS) expect(CATEGORIES).toContain(p.category);
  });

  it('keeps every preset playable: sane levels, envelopes and filters', () => {
    for (const p of INSTRUMENT_PRESETS) {
      const where = `${p.id}`;
      expect(p.layers.length, where).toBeGreaterThan(0);
      for (const l of p.layers) {
        expect(l.gain, where).toBeGreaterThan(0);
        expect(l.gain, where).toBeLessThanOrEqual(1);
        expect(Math.abs(l.octave), where).toBeLessThanOrEqual(4);
      }
      expect(p.volume, where).toBeGreaterThan(0.2);
      expect(p.volume, where).toBeLessThanOrEqual(1);
      expect(p.amp.attack, where).toBeGreaterThan(0);
      expect(p.amp.release, where).toBeGreaterThan(0);
      expect(p.amp.sustain, where).toBeGreaterThanOrEqual(0);
      expect(p.amp.sustain, where).toBeLessThanOrEqual(1);
      expect(p.filter.cutoff, where).toBeGreaterThanOrEqual(80);
      expect(p.filter.cutoff, where).toBeLessThanOrEqual(16000);
      for (const v of Object.values(p.send)) {
        expect(v, where).toBeGreaterThanOrEqual(0);
        expect(v, where).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is broad beyond guitars, basses, pianos and drums', () => {
    const count = (c: string) => INSTRUMENT_PRESETS.filter((p) => p.category === c).length;
    const core = ['Piano', 'Electric Guitar', 'Acoustic Guitar', 'Bass Guitar', 'Synth Bass'];
    const other = INSTRUMENT_PRESETS.filter((p) => !core.includes(p.category)).length;
    expect(other).toBeGreaterThanOrEqual(150);
    for (const c of ['Strings', 'Brass', 'Woodwind', 'Mallets', 'Plucked', 'Vocal', 'World']) {
      expect(count(c), c).toBeGreaterThanOrEqual(9);
    }
  });
});
