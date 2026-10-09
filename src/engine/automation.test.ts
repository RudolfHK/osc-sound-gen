import { describe, it, expect } from 'vitest';
import { scheduleLaneOnParam, laneRealAt } from './automation';
import type { AutomationLane } from '../utils/music';

/** Records what would be written to an AudioParam and evaluates it like Web Audio. */
function fakeParam() {
  const events: { kind: 'set' | 'lin' | 'exp'; value: number; time: number }[] = [];
  const param = {
    cancelScheduledValues: () => { events.length = 0; return param; },
    setValueAtTime: (value: number, time: number) => { events.push({ kind: 'set', value, time }); return param; },
    linearRampToValueAtTime: (value: number, time: number) => { events.push({ kind: 'lin', value, time }); return param; },
    exponentialRampToValueAtTime: (value: number, time: number) => { events.push({ kind: 'exp', value, time }); return param; },
  };
  const valueAt = (t: number) => {
    let prev = events[0];
    for (const e of events.slice(1)) {
      if (t <= e.time) {
        const f = (t - prev.time) / (e.time - prev.time || 1);
        return e.kind === 'exp'
          ? prev.value * Math.pow(e.value / prev.value, f)
          : prev.value + (e.value - prev.value) * f;
      }
      prev = e;
    }
    return prev.value;
  };
  return { param: param as unknown as AudioParam, events, valueAt };
}

const lane = (target: AutomationLane['target'], pts: [number, number][]): AutomationLane => ({
  id: 'l', target, enabled: true,
  points: pts.map(([beat, value], i) => ({ id: `p${i}`, beat, value })),
});

describe('writing a lane onto an AudioParam', () => {
  it('uses one ramp per breakpoint, not hundreds of samples', () => {
    const l = lane('volume', [[0, 0], [4, 1], [8, 0.5], [40, 0.2]]);
    const { param, events } = fakeParam();
    // 32 beats at 120 BPM: the old sampler wrote 256 events here
    scheduleLaneOnParam(param, l, 10, 16, 2, 120);
    expect(events.length).toBe(1 + 2 + 1); // start, points at 4 and 8, end
  });

  it('reproduces the lane exactly, cutoff included', () => {
    for (const target of ['volume', 'cutoff'] as const) {
      const l = lane(target, [[0, 0.1], [3, 0.9], [5, 0.4]]);
      const { param, valueAt } = fakeParam();
      scheduleLaneOnParam(param, l, 0, 4, 0.5, 60); // one beat per second
      for (const beat of [0.5, 1, 2.2, 3, 3.7, 4.5]) {
        const expected = laneRealAt(l, beat);
        expect(valueAt(beat - 0.5) / expected, `${target} @ ${beat}`).toBeCloseTo(1, 6);
      }
    }
  });
});
