import { describe, it, expect } from 'vitest';
import { parsePosition } from '../utils/position';

describe('typed position', () => {
  it('reads bars, beats and sixteenths', () => {
    expect(parsePosition('1', 120, 4)).toBe(0);
    expect(parsePosition('17', 120, 4)).toBe(64);
    expect(parsePosition('17.3', 120, 4)).toBe(66);
    expect(parsePosition('17.3.2', 120, 4)).toBe(66.25);
    expect(parsePosition(' 2 ', 120, 3)).toBe(3);
  });

  it('reads a time', () => {
    expect(parsePosition('0:30', 120, 4)).toBe(60);
    expect(parsePosition('1:30', 60, 4)).toBe(90);
    expect(parsePosition('0:01.5', 120, 4)).toBe(3);
  });

  it('rejects what is not a position', () => {
    expect(parsePosition('', 120, 4)).toBeNull();
    expect(parsePosition('0', 120, 4)).toBeNull();
    expect(parsePosition('3.5', 120, 4)).toBeNull();   // no fifth beat in 4/4
    expect(parsePosition('abc', 120, 4)).toBeNull();
  });
});
