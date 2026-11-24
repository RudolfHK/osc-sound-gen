/**
 * Transitions into sections: risers that build over the bars before a
 * section, and impacts on its downbeat. Pure plans, in song beats; the
 * dialog turns them into clips and automation (snare rolls are drum
 * patterns, made by `makeRoll`).
 */
import type { PartNote } from './partGen';

export interface PlannedClip {
  startBeat: number;
  lengthBeats: number;
  name: string;
  notes: PartNote[];
}

export interface LanePoint { beat: number; value: number }

/** Where each transition may start: the earlier of its length and the previous section's start. */
export function leadIn(boundaries: number[], beat: number, beats: number): number {
  const prev = Math.max(0, ...boundaries.filter((b) => b < beat - 1e-6));
  return Math.max(prev, beat - beats);
}

/**
 * A riser into each boundary: one held note over the lead-in, with the
 * filter opening and the level rising to the downbeat, then snapping back.
 * `allStarts` are every section start (so a riser never reaches back past
 * the section before).
 */
export function planRisers(targets: number[], allStarts: number[], beatsPerBar: number, bars: number): {
  clips: PlannedClip[]; cutoff: LanePoint[]; volume: LanePoint[];
} {
  const clips: PlannedClip[] = [];
  const cutoff: LanePoint[] = [];
  const volume: LanePoint[] = [];
  for (const b of [...targets].sort((x, y) => x - y)) {
    const start = leadIn(allStarts, b, bars * beatsPerBar);
    const len = b - start;
    if (len < 1 - 1e-6) continue;
    clips.push({ startBeat: start, lengthBeats: len, name: 'Riser', notes: [{ midiNote: 60, startBeat: 0, durationBeats: len, velocity: 100 }] });
    const top = b - Math.min(0.05, len / 10);
    cutoff.push({ beat: start, value: 0.12 }, { beat: top, value: 0.95 }, { beat: b, value: 0.12 });
    volume.push({ beat: start, value: 0.2 }, { beat: top, value: 0.85 }, { beat: b, value: 0.2 });
  }
  return { clips, cutoff, volume };
}

/** An impact on each boundary's downbeat, in a one-bar clip (shorter if the next section comes sooner). */
export function planImpacts(targets: number[], allStarts: number[], beatsPerBar: number, songEnd: number): PlannedClip[] {
  return [...targets].sort((x, y) => x - y).map((b) => {
    const next = Math.min(songEnd, ...allStarts.filter((s) => s > b + 1e-6));
    const len = Math.min(beatsPerBar, next - b);
    return { startBeat: b, lengthBeats: len, name: 'Impact', notes: [{ midiNote: 52, startBeat: 0, durationBeats: Math.min(1, len), velocity: 110 }] };
  }).filter((c) => c.lengthBeats >= 0.25);
}

/** Lane points with the ones inside each [from, to] span replaced by `add`. */
export function mergeLanePoints<T extends LanePoint>(existing: T[], spans: { from: number; to: number }[], add: T[]): T[] {
  const kept = existing.filter((p) => !spans.some((s) => p.beat >= s.from - 1e-9 && p.beat <= s.to + 1e-9));
  return [...kept, ...add].sort((a, b) => a.beat - b.beat);
}
