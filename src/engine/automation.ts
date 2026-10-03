import type { AutomationLane, AutomationPoint, AutomationTarget } from '../utils/music';

// ─── Target definitions ───────────────────────────────────────────────────────

interface TargetSpec {
  label: string;
  color: string;
  /** Maps a normalized 0–1 lane value onto the parameter's real range. */
  toReal: (v: number) => number;
  /** Inverse of toReal, for seeding a lane from a current value. */
  toNorm: (real: number) => number;
  format: (real: number) => string;
  /** Lane value used where no automation exists. */
  neutral: number;
}

/** Cutoff sweeps must be exponential or the top octave eats the whole lane. */
const CUTOFF_MIN = 60;
const CUTOFF_RATIO = 300;   // 60 Hz … 18 kHz

export const AUTOMATION_TARGETS: Record<AutomationTarget, TargetSpec> = {
  volume: {
    label: 'Volume', color: '#22c55e', neutral: 0.667,
    toReal: (v) => v * 1.5,
    toNorm: (r) => r / 1.5,
    format: (r) => `${Math.round(r * 100)}%`,
  },
  pan: {
    label: 'Pan', color: '#06b6d4', neutral: 0.5,
    toReal: (v) => v * 2 - 1,
    toNorm: (r) => (r + 1) / 2,
    format: (r) => r === 0 ? 'C' : r > 0 ? `R${Math.round(r * 100)}` : `L${Math.round(-r * 100)}`,
  },
  cutoff: {
    label: 'Filter Cutoff', color: '#f43f5e', neutral: 1,
    toReal: (v) => CUTOFF_MIN * Math.pow(CUTOFF_RATIO, v),
    toNorm: (r) => Math.log(Math.max(CUTOFF_MIN, r) / CUTOFF_MIN) / Math.log(CUTOFF_RATIO),
    format: (r) => r >= 1000 ? `${(r / 1000).toFixed(2)} kHz` : `${Math.round(r)} Hz`,
  },
  resonance: {
    label: 'Resonance', color: '#f59e0b', neutral: 0.05,
    toReal: (v) => 0.1 + v * 24,
    toNorm: (r) => (r - 0.1) / 24,
    format: (r) => r.toFixed(1),
  },
  drive: {
    label: 'Drive', color: '#ef4444', neutral: 0,
    toReal: (v) => v,
    toNorm: (r) => r,
    format: (r) => `${Math.round(r * 100)}%`,
  },
  sendReverb: {
    label: 'Reverb Send', color: '#8b5cf6', neutral: 0,
    toReal: (v) => v, toNorm: (r) => r,
    format: (r) => `${Math.round(r * 100)}%`,
  },
  sendDelay: {
    label: 'Delay Send', color: '#0ea5e9', neutral: 0,
    toReal: (v) => v, toNorm: (r) => r,
    format: (r) => `${Math.round(r * 100)}%`,
  },
  sendChorus: {
    label: 'Chorus Send', color: '#14b8a6', neutral: 0,
    toReal: (v) => v, toNorm: (r) => r,
    format: (r) => `${Math.round(r * 100)}%`,
  },
  eqLow: {
    label: 'EQ Low', color: '#a855f7', neutral: 0.5,
    toReal: (v) => v * 36 - 18, toNorm: (r) => (r + 18) / 36,
    format: (r) => `${r > 0 ? '+' : ''}${r.toFixed(1)} dB`,
  },
  eqMid: {
    label: 'EQ Mid', color: '#c084fc', neutral: 0.5,
    toReal: (v) => v * 36 - 18, toNorm: (r) => (r + 18) / 36,
    format: (r) => `${r > 0 ? '+' : ''}${r.toFixed(1)} dB`,
  },
  eqHigh: {
    label: 'EQ High', color: '#e879f9', neutral: 0.5,
    toReal: (v) => v * 36 - 18, toNorm: (r) => (r + 18) / 36,
    format: (r) => `${r > 0 ? '+' : ''}${r.toFixed(1)} dB`,
  },
};

export const AUTOMATION_TARGET_LIST = Object.keys(AUTOMATION_TARGETS) as AutomationTarget[];

/** Targets that shape an individual voice, so they are baked in at note start. */
export const VOICE_TARGETS: AutomationTarget[] = ['cutoff', 'resonance', 'drive'];

/** Targets that live on the track's channel strip and move continuously. */
export const CHANNEL_TARGETS: AutomationTarget[] = [
  'volume', 'pan', 'sendReverb', 'sendDelay', 'sendChorus', 'eqLow', 'eqMid', 'eqHigh',
];

// ─── Evaluation ───────────────────────────────────────────────────────────────

/**
 * Lane value at a beat position. Points are linearly interpolated; before the
 * first and after the last point the lane holds that point's value.
 */
export function laneValueAt(lane: AutomationLane, beat: number): number {
  const pts = lane.points;
  if (pts.length === 0) return AUTOMATION_TARGETS[lane.target].neutral;
  if (pts.length === 1) return pts[0].value;
  if (beat <= pts[0].beat) return pts[0].value;
  if (beat >= pts[pts.length - 1].beat) return pts[pts.length - 1].value;

  // Points are kept sorted by beat, so a binary search is safe
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].beat <= beat) lo = mid; else hi = mid;
  }
  const a = pts[lo], b = pts[hi];
  const span = b.beat - a.beat;
  if (span <= 0) return b.value;
  const t = (beat - a.beat) / span;
  return a.value + (b.value - a.value) * t;
}

/** Real (un-normalized) lane value at a beat. */
export function laneRealAt(lane: AutomationLane, beat: number): number {
  return AUTOMATION_TARGETS[lane.target].toReal(laneValueAt(lane, beat));
}

export function findLane(
  lanes: AutomationLane[] | undefined,
  target: AutomationTarget,
): AutomationLane | null {
  if (!lanes) return null;
  const lane = lanes.find((l) => l.target === target && l.enabled && l.points.length > 0);
  return lane ?? null;
}

// ─── Scheduling onto AudioParams ──────────────────────────────────────────────

/** How finely a lane is sampled when written onto an AudioParam. */
const RAMP_STEPS_PER_BEAT = 8;
const MAX_RAMP_POINTS = 400;

/**
 * Write a lane onto an AudioParam across a time span.
 *
 * Sampling rather than mapping breakpoints one-to-one keeps a long sustained
 * note moving even when the lane's points are far apart, which is the whole
 * point of automating a filter under a held chord.
 */
export function scheduleLaneOnParam(
  param: AudioParam,
  lane: AutomationLane,
  startTime: number,
  durationS: number,
  startBeat: number,
  bpm: number,
  transform?: (real: number) => number,
): void {
  const spec = AUTOMATION_TARGETS[lane.target];
  const beatsPerSecond = bpm / 60;
  const beats = durationS * beatsPerSecond;
  const steps = Math.max(1, Math.min(MAX_RAMP_POINTS, Math.ceil(beats * RAMP_STEPS_PER_BEAT)));

  const valueAt = (i: number) => {
    const frac = i / steps;
    const real = spec.toReal(laneValueAt(lane, startBeat + beats * frac));
    return transform ? transform(real) : real;
  };

  param.cancelScheduledValues(startTime);
  param.setValueAtTime(valueAt(0), startTime);
  for (let i = 1; i <= steps; i++) {
    param.linearRampToValueAtTime(valueAt(i), startTime + durationS * (i / steps));
  }
}

// ─── Point helpers used by the editor ─────────────────────────────────────────

let _pointId = 0;
export function makePointId(): string {
  return `ap-${Date.now()}-${_pointId++}`;
}

let _laneId = 0;
export function makeLaneId(): string {
  return `al-${Date.now()}-${_laneId++}`;
}

/** Insert a point and keep the lane sorted. */
export function withPoint(points: AutomationPoint[], point: AutomationPoint): AutomationPoint[] {
  return [...points, point].sort((a, b) => a.beat - b.beat);
}
