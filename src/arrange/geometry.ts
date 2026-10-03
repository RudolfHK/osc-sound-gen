import { SNAP_BEATS, type SequencerState } from '../utils/music';

export const HEADER_W = 236;
export const TRACK_H = 58;
export const AUTO_H = 76;
export const RULER_SECTION_H = 20;
export const RULER_BARS_H = 22;
export const RULER_H = RULER_SECTION_H + RULER_BARS_H;
/** Pixels from a clip edge that count as grabbing the edge. */
export const EDGE_PX = 6;

export interface ArrView {
  startBeat: number;
  pxPerBeat: number;
}

export const beatToX = (beat: number, v: ArrView) => (beat - v.startBeat) * v.pxPerBeat;
export const xToBeat = (x: number, v: ArrView) => v.startBeat + x / v.pxPerBeat;

/** Arrangement grid size in beats. "1/1" means one bar in the current signature. */
export function arrangeGrid(seq: Pick<SequencerState, 'arrangeSnap' | 'beatsPerBar'>): number {
  return seq.arrangeSnap === '1/1' ? seq.beatsPerBar : SNAP_BEATS[seq.arrangeSnap];
}

export function snapTo(beat: number, grid: number, free = false): number {
  return free ? beat : Math.round(beat / grid) * grid;
}

/** Bar spacing for ruler labels so numbers never collide. */
export function labelEvery(pxPerBar: number): number {
  for (const n of [1, 2, 4, 8, 16, 32, 64]) if (pxPerBar * n >= 34) return n;
  return 128;
}
