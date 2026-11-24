/**
 * Rhythm helpers shared by playback, export and the drum editor: step
 * probability, ratchets and Euclidean rhythms. Pure and deterministic.
 */

/**
 * A number in [0, 1) that depends only on its inputs (FNV-1a, then a mix).
 * Step probability uses it instead of Math.random(), so a pattern with 50 %
 * hats sounds the same every time it plays — and in the export — while still
 * varying from bar to bar.
 */
export function hash01(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Final avalanche so neighbouring inputs don't give neighbouring outputs
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Does a step with this chance (0–1) play at this occurrence? */
export function stepPlays(chance: number | undefined, ...key: (string | number)[]): boolean {
  if (chance === undefined || chance >= 1) return true;
  if (chance <= 0) return false;
  return hash01(...key) < chance;
}

/** How many hits a step fires (1 = normal, up to 4), clamped. */
export function ratchetCount(ratchet: number | undefined): number {
  return Math.max(1, Math.min(4, Math.round(ratchet ?? 1)));
}

/**
 * Euclidean rhythm: `hits` onsets spread as evenly as possible over `steps`,
 * then rotated right by `rotate`. E(3, 8) is the tresillo x..x..x.; E(5, 8)
 * is the cinquillo family. Built with Bresenham's line, which gives the same
 * rhythms as Bjorklund's algorithm up to rotation, always starting on an onset.
 */
export function euclid(hits: number, steps: number, rotate = 0): boolean[] {
  const n = Math.max(0, Math.round(steps));
  const k = Math.max(0, Math.min(n, Math.round(hits)));
  const base = Array.from({ length: n }, (_, i) => k > 0 && ((i * k) % n) < k);
  if (n === 0) return base;
  const r = ((Math.round(rotate) % n) + n) % n;
  return base.map((_, i) => base[(i - r + n) % n]);
}

/** Seeded pseudo-random generator (mulberry32) for repeatable generators. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
