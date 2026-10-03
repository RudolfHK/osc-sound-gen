/**
 * Level measurement for exports: sample peak and integrated loudness
 * (ITU-R BS.1770-4 / EBU R128), plus normalization gain.
 *
 * Streaming services normalize by integrated loudness — Spotify, YouTube and
 * Apple Music aim for roughly −14 LUFS — so this, not peak level, is what
 * decides how loud a track plays back there.
 */

import type { PcmAudio } from './wav';

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(g: number): number {
  return 20 * Math.log10(Math.max(g, 1e-12));
}

/** Highest absolute sample value across all channels. */
export function samplePeak(audio: PcmAudio): number {
  let peak = 0;
  for (const ch of audio.channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

// ─── K-weighting ──────────────────────────────────────────────────────────────
//
// BS.1770 defines the filters as fixed coefficients at 48 kHz. Deriving them
// from their analog prototypes (as pyloudnorm does) gives the same response at
// any sample rate.

interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

function highShelf(fs: number): Biquad {
  const G = 3.99984385397, Q = 0.7071752369554193, fc = 1681.974450955533;
  const K = Math.tan(Math.PI * fc / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.499666774155);
  const a0 = 1 + K / Q + K * K;
  return {
    b0: (Vh + Vb * K / Q + K * K) / a0,
    b1: 2 * (K * K - Vh) / a0,
    b2: (Vh - Vb * K / Q + K * K) / a0,
    a1: 2 * (K * K - 1) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
}

function highPass(fs: number): Biquad {
  const Q = 0.5003270373238773, fc = 38.13547087613982;
  const K = Math.tan(Math.PI * fc / fs);
  const a0 = 1 + K / Q + K * K;
  return {
    b0: 1, b1: -2, b2: 1,
    a1: 2 * (K * K - 1) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
}

function filter(x: ArrayLike<number>, f: Biquad): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = f.b0 * xi + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
    y[i] = yi;
  }
  return y;
}

/**
 * Integrated loudness in LUFS, or −Infinity for silence or material shorter
 * than one 400 ms block.
 *
 * 400 ms blocks with 75 % overlap; blocks below −70 LUFS are dropped
 * (absolute gate), then blocks more than 10 LU below the remaining mean
 * (relative gate). Left and right are weighted 1.0; mono counts once.
 */
export function integratedLoudness(audio: PcmAudio): number {
  const fs = audio.sampleRate;
  const shelf = highShelf(fs);
  const hp = highPass(fs);
  const weighted = audio.channels.slice(0, 2).map((ch) => filter(filter(ch, shelf), hp));

  const block = Math.round(0.4 * fs);
  const step = Math.round(0.1 * fs);
  const frames = weighted[0]?.length ?? 0;
  if (frames < block) return Number.NEGATIVE_INFINITY;

  // Prefix sums of squares make each block O(1)
  const prefix = weighted.map((w) => {
    const p = new Float64Array(w.length + 1);
    for (let i = 0; i < w.length; i++) p[i + 1] = p[i] + w[i] * w[i];
    return p;
  });

  const blockPower: number[] = [];
  for (let start = 0; start + block <= frames; start += step) {
    let z = 0;
    for (const p of prefix) z += (p[start + block] - p[start]) / block;
    blockPower.push(z);
  }

  const lufs = (z: number) => -0.691 + 10 * Math.log10(z);
  const absGated = blockPower.filter((z) => lufs(z) > -70);
  if (absGated.length === 0) return Number.NEGATIVE_INFINITY;

  const relThreshold = lufs(mean(absGated)) - 10;
  const gated = absGated.filter((z) => lufs(z) > relThreshold);
  return lufs(mean(gated));
}

function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

// ─── Normalization ────────────────────────────────────────────────────────────

export type Normalize =
  | { mode: 'off' }
  | { mode: 'peak'; ceilingDb: number }
  | { mode: 'loudness'; targetLufs: number; ceilingDb: number };

export interface LevelReport {
  peakDb: number;
  lufs: number;
  /** Gain applied by normalization, in dB. */
  gainDb: number;
  /** Loudness target couldn't be reached without exceeding the peak ceiling. */
  ceilingLimited: boolean;
}

/**
 * Work out the normalization gain. Loudness normalization never pushes peaks
 * past the ceiling — raising a quiet mix to −14 LUFS can't be allowed to clip.
 */
export function normalizationGain(peak: number, lufs: number, n: Normalize): { gainDb: number; ceilingLimited: boolean } {
  if (n.mode === 'off' || peak <= 0) return { gainDb: 0, ceilingLimited: false };
  const toCeiling = n.ceilingDb - gainToDb(peak);
  if (n.mode === 'peak') return { gainDb: toCeiling, ceilingLimited: false };
  if (!Number.isFinite(lufs)) return { gainDb: 0, ceilingLimited: false };
  const toTarget = n.targetLufs - lufs;
  return toTarget > toCeiling
    ? { gainDb: toCeiling, ceilingLimited: true }
    : { gainDb: toTarget, ceilingLimited: false };
}

/** Measure, normalize in place, and report the result. */
export function normalizeInPlace(audio: PcmAudio, n: Normalize): LevelReport {
  const peak = samplePeak(audio);
  const lufs = integratedLoudness(audio);
  const { gainDb, ceilingLimited } = normalizationGain(peak, lufs, n);
  if (gainDb !== 0) {
    const g = dbToGain(gainDb);
    for (const ch of audio.channels) for (let i = 0; i < ch.length; i++) ch[i] *= g;
  }
  return {
    peakDb: gainToDb(peak) + gainDb,
    lufs: lufs + gainDb,
    gainDb,
    ceilingLimited,
  };
}
