import { describe, it, expect } from 'vitest';
import { matchGainDb, shortTermOf } from './reference';
import { blockLufs, gatedLoudness } from '../export/loudness';

const power = (lufs: number) => Math.pow(10, (lufs + 0.691) / 10);

describe('live loudness', () => {
  it('reads a block power as LUFS', () => {
    expect(blockLufs(power(-14))).toBeCloseTo(-14, 6);
  });

  it('gates silence and quiet passages out of the integrated value', () => {
    const blocks = [...Array(50).fill(power(-14)), ...Array(50).fill(power(-80)), ...Array(10).fill(power(-30))];
    expect(gatedLoudness(blocks)).toBeCloseTo(-14, 1);
    expect(gatedLoudness([power(-90)])).toBe(-Infinity);
  });

  it('short-term follows the last 3 seconds', () => {
    const blocks = [...Array(100).fill(power(-30)), ...Array(27).fill(power(-10))];
    expect(shortTermOf(blocks)).toBeCloseTo(-10, 6);
    expect(shortTermOf([])).toBe(-Infinity);
  });
});

describe('reference level matching', () => {
  it('turns a louder reference down to the mix, within limits', () => {
    expect(matchGainDb(-14, -8)).toBeCloseTo(-6);
    expect(matchGainDb(-14, -20)).toBeCloseTo(6);
    expect(matchGainDb(-60, -5)).toBe(-30);
    expect(matchGainDb(-5, -40)).toBe(12);
    expect(matchGainDb(-Infinity, -8)).toBe(0);
  });
});
