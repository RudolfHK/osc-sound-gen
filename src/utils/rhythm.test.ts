import { describe, it, expect } from 'vitest';
import { euclid, hash01, ratchetCount, seededRandom, stepPlays } from './rhythm';
import { eventsInWindow, type TimelineInput } from '../engine/timeline';
import { makeTrack, makeClip } from './music';
import { patternFromHits, type HitSpec } from '../store/drumStore';

const asString = (row: boolean[]) => row.map((b) => (b ? 'x' : '.')).join('');

describe('Euclidean rhythms', () => {
  it('spreads hits evenly', () => {
    expect(asString(euclid(3, 8))).toBe('x..x..x.');
    expect(asString(euclid(4, 16))).toBe('x...x...x...x...');
    expect(euclid(5, 8).filter(Boolean)).toHaveLength(5);
    expect(asString(euclid(0, 8))).toBe('........');
    expect(asString(euclid(8, 8))).toBe('xxxxxxxx');
  });

  it('rotates to the right, wrapping', () => {
    expect(asString(euclid(3, 8, 1))).toBe('.x..x..x');
    expect(asString(euclid(3, 8, 8))).toBe('x..x..x.');
    expect(asString(euclid(3, 8, -1))).toBe('..x..x.x');
  });

  it('clamps nonsense input', () => {
    expect(euclid(20, 8).filter(Boolean)).toHaveLength(8);
    expect(euclid(3, 0)).toEqual([]);
  });
});

describe('step probability', () => {
  it('is deterministic and roughly matches the chance', () => {
    expect(hash01('a', 1)).toBe(hash01('a', 1));
    expect(hash01('a', 1)).not.toBe(hash01('a', 2));
    let plays = 0;
    for (let i = 0; i < 4000; i++) if (stepPlays(0.3, 'clip', 'hihat-c', 3, i)) plays++;
    expect(plays / 4000).toBeGreaterThan(0.26);
    expect(plays / 4000).toBeLessThan(0.34);
  });

  it('treats 100 % and 0 % exactly', () => {
    expect(stepPlays(undefined, 'x')).toBe(true);
    expect(stepPlays(1, 'x')).toBe(true);
    expect(stepPlays(0, 'x')).toBe(false);
  });

  it('clamps ratchets to 1–4', () => {
    expect(ratchetCount(undefined)).toBe(1);
    expect(ratchetCount(3)).toBe(3);
    expect(ratchetCount(9)).toBe(4);
    expect(ratchetCount(0)).toBe(1);
  });

  it('seeds a repeatable random stream', () => {
    const a = seededRandom(42), b = seededRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('drum steps in the timeline', () => {
  const input = (hats: HitSpec[]): TimelineInput => {
    const pattern = patternFromHits('t', 'Test', 16, 0, { 'hihat-c': hats });
    const drums = makeTrack({ name: 'Drums', source: { type: 'drums' } });
    drums.clips = [makeClip(pattern.id, 0, 16)];
    return {
      tracks: [drums], patterns: {}, drumPatterns: new Map([[pattern.id, pattern]]),
      notesFor: () => [], metronome: false, beatsPerBar: 4,
    };
  };
  const hits = (i: TimelineInput) => eventsInWindow(i, 0, 16, { enabled: false, start: 0, end: 0 }, false).map((e) => e.monoBeat);

  it('a ratchet splits the step into equal hits', () => {
    const at = hits(input([{ step: 2, ratchet: 4 }])).filter((b) => b < 4);
    expect(at).toEqual([0.5, 0.5625, 0.625, 0.6875]);
  });

  it('probability thins the hits the same way on every pass, bar by bar', () => {
    const i = input(Array.from({ length: 16 }, (_, step) => ({ step, chance: 0.5 })));
    const first = hits(i);
    expect(first.length).toBeGreaterThan(16);   // 64 candidates over four bars
    expect(first.length).toBeLessThan(48);
    expect(hits(i)).toEqual(first);
    // Different bars make different choices
    const bar = (n: number) => first.filter((b) => b >= n * 4 && b < n * 4 + 4).map((b) => b - n * 4).join();
    expect(new Set([bar(0), bar(1), bar(2), bar(3)]).size).toBeGreaterThan(1);
  });
});
