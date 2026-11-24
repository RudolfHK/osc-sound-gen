import { describe, it, expect } from 'vitest';
import { DRUM_STYLES, FILL_KINDS, generateDrumPattern, makeFill, varyPattern } from './drumGen';
import { hitsOf } from '../store/drumStore';
import { reducer, makeInitialAppState } from '../store/appStore';

const stepsOf = (p: ReturnType<typeof generateDrumPattern>, voice: string) =>
  (hitsOf(p) as Record<string, { step: number }[]>)[voice]?.map((h) => h.step) ?? [];

describe('drum pattern generator', () => {
  it('is repeatable for a seed and varies between seeds', () => {
    const a = generateDrumPattern('house', 7, 0.6), b = generateDrumPattern('house', 7, 0.6);
    expect(hitsOf(a)).toEqual(hitsOf(b));
    const others = [8, 9, 10, 11].map((s) => JSON.stringify(hitsOf(generateDrumPattern('house', s, 0.6))));
    expect(new Set([JSON.stringify(hitsOf(a)), ...others]).size).toBeGreaterThan(1);
  });

  it('keeps the defining groove of each style', () => {
    for (let seed = 1; seed < 20; seed++) {
      expect(stepsOf(generateDrumPattern('house', seed), 'kick')).toEqual([0, 4, 8, 12]);
      expect(stepsOf(generateDrumPattern('trap', seed), 'snare')).toEqual([8]);
      expect(stepsOf(generateDrumPattern('dembow', seed), 'snare')).toEqual([3, 6, 11, 14]);
      expect(stepsOf(generateDrumPattern('boom-bap', seed), 'snare')).toContain(4);
    }
  });

  it('trap hats roll (ratchets) and every style produces a full, playable pattern', () => {
    const trap = generateDrumPattern('trap', 3);
    expect(trap.voices.find((v) => v.id === 'hihat-c')!.steps.some((s) => (s.ratchet ?? 1) > 1)).toBe(true);
    for (const st of DRUM_STYLES) {
      const p = generateDrumPattern(st.id, 1);
      expect(p.voices.length).toBeGreaterThan(30);
      expect(p.voices.every((v) => v.steps.length === 16)).toBe(true);
      expect(Object.keys(hitsOf(p)).length).toBeGreaterThanOrEqual(3);
      expect(p.genre).toBe(st.genre);
    }
  });

  it('busier settings add hits', () => {
    const count = (busy: number) => [1, 2, 3, 4, 5].reduce((n, seed) =>
      n + Object.values(hitsOf(generateDrumPattern('deep-house', seed, busy))).flat().length, 0);
    expect(count(1)).toBeGreaterThan(count(0));
  });
});

describe('variations and fills', () => {
  const base = generateDrumPattern('rock', 5, 0.5);

  it('a variation keeps the kick on one and the backbeat', () => {
    for (let seed = 1; seed < 15; seed++) {
      const v = varyPattern(base, seed, 1);
      expect(stepsOf(v, 'kick')).toContain(0);
      expect(stepsOf(v, 'snare')).toEqual(expect.arrayContaining([4, 12]));
      expect(v.id).not.toBe(base.id);
    }
  });

  it('a fill keeps the groove, then fills the end of the bar', () => {
    for (const kind of FILL_KINDS) {
      const f = makeFill(base, 2, { kind });
      expect(stepsOf(f, 'kick')).toContain(0);
      // Nothing from the groove's hats inside the last beat
      expect(stepsOf(f, 'hihat-c').every((s) => s < 12)).toBe(true);
      const tail = Object.values(hitsOf(f)).flat().filter((h) => h.step >= 12);
      expect(tail.length).toBeGreaterThan(0);
    }
    const roll = makeFill(base, 2, { kind: 'snare-roll' });
    expect(roll.voices.find((v) => v.id === 'snare')!.steps[15].ratchet).toBe(2);
  });

  it('fits a fill to the bar in 3/4', () => {
    const f = makeFill(base, 4, { kind: 'snare-roll', barSteps: 12 });
    const snare = stepsOf(f, 'snare');
    expect(Math.max(...snare)).toBe(11);
    expect(Object.values(hitsOf(f)).flat().every((h) => h.step < 12)).toBe(true);
  });
});

describe('dropping a clip into a range', () => {
  it('cuts the clips it overlaps and keeps the pattern position after it', () => {
    let s = makeInitialAppState();
    const drums = s.sequencer.tracks.find((t) => t.source.type === 'drums')!.id;
    s = reducer(s, { type: 'CLIP_ADD', trackId: drums, startBeat: 0, lengthBeats: 32, patternId: 'groove' });
    s = reducer(s, { type: 'CLIP_REPLACE_RANGE', trackId: drums, startBeat: 12, endBeat: 16, patternId: 'fill' });
    const clips = s.sequencer.tracks.find((t) => t.id === drums)!.clips
      .map((c) => [c.patternId, c.startBeat, c.lengthBeats, c.offsetBeats]);
    expect(clips).toEqual([['groove', 0, 12, 0], ['fill', 12, 4, 0], ['groove', 16, 16, 16]]);
  });
});
