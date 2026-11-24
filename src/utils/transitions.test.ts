import { describe, it, expect } from 'vitest';
import { leadIn, mergeLanePoints, planImpacts, planRisers } from './transitions';
import { makeRoll, generateDrumPattern } from './drumGen';
import { hitsOf } from '../store/drumStore';

describe('planRisers', () => {
  it('builds over the bars before each section, never past the previous section', () => {
    const starts = [0, 16, 24, 56];
    const { clips } = planRisers([16, 24, 56], starts, 4, 4);
    // into 16: bars 3–4; into 24: only 8 beats since Verse began at 16; into 56: 16 beats
    expect(clips.map((c) => [c.startBeat, c.lengthBeats])).toEqual([[0, 16], [16, 8], [40, 16]]);
    expect(clips.every((c) => c.notes.length === 1 && c.notes[0].durationBeats === c.lengthBeats)).toBe(true);
  });

  it('opens the filter and raises the level to the downbeat, then resets', () => {
    const { cutoff, volume } = planRisers([16], [0, 16], 4, 2);
    expect(cutoff.map((p) => p.beat)).toEqual([8, 15.95, 16]);
    expect(cutoff[1].value).toBeGreaterThan(cutoff[0].value);
    expect(cutoff[2].value).toBe(cutoff[0].value);
    expect(volume[1].value).toBeGreaterThan(volume[0].value);
  });

  it('skips a boundary with no room for a riser', () => {
    expect(planRisers([0], [0], 4, 2).clips).toEqual([]);
  });
});

describe('planImpacts', () => {
  it('lands on each downbeat, a bar long or up to the next section', () => {
    const clips = planImpacts([16, 18], [0, 16, 18], 4, 32);
    expect(clips.map((c) => [c.startBeat, c.lengthBeats])).toEqual([[16, 2], [18, 4]]);
    expect(clips[0].notes[0]).toMatchObject({ startBeat: 0, velocity: 110 });
  });
});

describe('leadIn and lane merging', () => {
  it('starts a lead-in no earlier than the section before', () => {
    expect(leadIn([0, 16, 20], 20, 8)).toBe(16);
    expect(leadIn([0, 16], 16, 8)).toBe(8);
  });

  it('replaces points inside the spans and keeps the rest', () => {
    const existing = [{ beat: 0, value: 0.5 }, { beat: 10, value: 0.1 }, { beat: 30, value: 0.9 }];
    const merged = mergeLanePoints(existing, [{ from: 8, to: 16 }], [{ beat: 8, value: 0.2 }, { beat: 16, value: 0.8 }]);
    expect(merged).toEqual([{ beat: 0, value: 0.5 }, { beat: 8, value: 0.2 }, { beat: 16, value: 0.8 }, { beat: 30, value: 0.9 }]);
  });
});

describe('makeRoll', () => {
  it('speeds up and gets louder, doubling the last two steps', () => {
    const roll = makeRoll(null, { bars: 1 });
    const snare = hitsOf(roll).snare!;
    const gaps = snare.slice(1).map((h, i) => h.step - snare[i].step);
    expect(gaps[0]).toBe(2);
    expect(gaps.at(-1)).toBe(1);
    expect(snare.at(-1)!.velocity!).toBeGreaterThan(snare[0].velocity!);
    expect(snare.slice(-2).every((h) => h.ratchet === 2)).toBe(true);
  });

  it('a two-bar roll starts in quarter notes and fits a 32-step pattern', () => {
    const roll = makeRoll(null, { bars: 2 });
    expect(roll.stepCount).toBe(32);
    const snare = hitsOf(roll).snare!;
    expect(snare[1].step - snare[0].step).toBe(4);
    expect(snare.at(-1)!.step).toBe(31);
  });

  it('keeps the groove\'s kick, but leaves the last beat empty', () => {
    const base = generateDrumPattern('house', 1, 0.5);
    const kick = hitsOf(makeRoll(base, { bars: 1 })).kick ?? [];
    expect(kick.map((h) => h.step)).toEqual([0, 4, 8]);
  });

  it('fits a 3/4 bar', () => {
    const roll = makeRoll(null, { bars: 1, barSteps: 12 });
    expect(Math.max(...hitsOf(roll).snare!.map((h) => h.step))).toBe(11);
  });
});
