/**
 * Drum pattern generator: genre styles, variations of an existing pattern,
 * and fills. Everything is seeded, so the same seed gives the same pattern
 * (tests rely on it, and "generate" can be repeated deliberately).
 *
 * The styles are written from the rhythmic conventions of each genre — where
 * the kick, backbeat and hats sit, how much they swing — with a random layer
 * of optional hits on top, controlled by `busy` (0 = the bare groove, 1 =
 * every optional hit is likely).
 */
import type { DrumVoiceType } from '../engine/sampler';
import { hitsOf, patternFromHits, type DrumPattern, type HitSpec } from '../store/drumStore';
import { seededRandom } from './rhythm';

type Hits = Partial<Record<DrumVoiceType, HitSpec[]>>;
type Rand = () => number;

export interface DrumStyle {
  id: string;
  name: string;
  /** Genre the pattern is filed under in the drum editor. */
  genre: string;
  /** Typical tempo, shown in the menu. */
  bpm: number;
  swing: number;
  build: (rand: Rand, busy: number) => Hits;
}

// ─── Building blocks ──────────────────────────────────────────────────────────

const at = (steps: number[], velocity = 100): HitSpec[] => steps.map((step) => ({ step, velocity }));

/** Each step with probability `p` (scaled by busy), at a velocity in [lo, hi]. */
function maybe(rand: Rand, steps: number[], p: number, lo = 60, hi = 100): HitSpec[] {
  return steps.filter(() => rand() < p).map((step) => ({ step, velocity: Math.round(lo + rand() * (hi - lo)) }));
}

/** Sixteenth hats with accents on the beat and softer in-betweens. */
function sixteenths(rand: Rand, accent = 100, soft = 62): HitSpec[] {
  return Array.from({ length: 16 }, (_, step) => ({
    step, velocity: step % 4 === 0 ? accent : step % 2 === 0 ? accent - 18 : soft + Math.round(rand() * 10),
  }));
}

const pick = <T,>(rand: Rand, list: T[]): T => list[Math.floor(rand() * list.length)];
const merge = (...lists: HitSpec[][]): HitSpec[] => {
  const byStep = new Map<number, HitSpec>();
  for (const l of lists) for (const h of l) if (!byStep.has(h.step)) byStep.set(h.step, h);
  return [...byStep.values()].sort((a, b) => a.step - b.step);
};

// ─── Styles ───────────────────────────────────────────────────────────────────

export const DRUM_STYLES: DrumStyle[] = [
  {
    id: 'house', name: 'House', genre: 'House', bpm: 124, swing: 0.05,
    build: (r, busy) => ({
      'kick': at([0, 4, 8, 12], 115),
      'clap': at([4, 12], 105),
      'hihat-o': at([2, 6, 10, 14], 85),
      'hihat-c': merge(at([0, 4, 8, 12], 70), maybe(r, [1, 3, 5, 7, 9, 11, 13, 15], 0.4 + busy * 0.5, 45, 70)),
      'shaker': busy > 0.4 ? sixteenths(r, 70, 40) : [],
      'conga-hi': maybe(r, [3, 7, 11, 14], busy * 0.6, 60, 90),
      'rim': maybe(r, [7, 15], busy * 0.4, 55, 80),
    }),
  },
  {
    id: 'deep-house', name: 'Deep house', genre: 'Deep House', bpm: 120, swing: 0.14,
    build: (r, busy) => ({
      'kick': at([0, 4, 8, 12], 108),
      'clap': at([4, 12], 92),
      'snare': maybe(r, [15], busy * 0.5, 40, 60),
      'hihat-o': at([2, 6, 10, 14], 72),
      'hihat-c': maybe(r, [1, 3, 5, 7, 9, 11, 13, 15], 0.5 + busy * 0.4, 38, 60),
      'shaker': sixteenths(r, 60, 32),
      'rim': maybe(r, [3, 6, 10, 13], 0.25 + busy * 0.4, 50, 75),
      'conga-lo': maybe(r, [7, 14], busy * 0.5, 55, 80),
    }),
  },
  {
    id: 'techno', name: 'Techno', genre: 'Techno', bpm: 132, swing: 0,
    build: (r, busy) => ({
      'kick': at([0, 4, 8, 12], 120),
      'clap': maybe(r, [4, 12], 0.5 + busy * 0.3, 85, 100),
      'hihat-o': at([2, 6, 10, 14], 90),
      'hihat-c': merge(at([0, 4, 8, 12], 60), maybe(r, [1, 3, 5, 7, 9, 11, 13, 15], 0.3 + busy * 0.6, 40, 65)),
      'ride': maybe(r, [0, 2, 4, 6, 8, 10, 12, 14], busy * 0.7, 50, 70),
      'rim': maybe(r, [3, 6, 9, 11, 14], 0.2 + busy * 0.5, 60, 90),
      'tom-lo': maybe(r, [7, 15], busy * 0.3, 60, 80),
    }),
  },
  {
    id: 'boom-bap', name: 'Boom bap', genre: 'Hip-Hop', bpm: 90, swing: 0.22,
    build: (r, busy) => ({
      'kick': merge(at([0], 115), at([pick(r, [7, 10])], 100), maybe(r, [3, 9, 14], 0.2 + busy * 0.4, 80, 100)),
      'snare': merge(at([4, 12], 110), maybe(r, [7, 15], busy * 0.5, 35, 55)),
      'hihat-c': merge(at([0, 2, 4, 6, 8, 10, 12, 14], 80), maybe(r, [5, 13], busy * 0.5, 45, 60)),
      'hihat-o': maybe(r, [14], 0.3 + busy * 0.3, 60, 75),
      'rim': maybe(r, [3, 11], busy * 0.3, 50, 70),
    }),
  },
  {
    id: 'trap', name: 'Trap', genre: 'Trap', bpm: 140, swing: 0,
    build: (r, busy) => {
      // Hats in sixteenths with a roll or two (ratchets) — the genre's signature
      const roll = pick(r, [6, 7, 14, 15]);
      const hats = sixteenths(r, 90, 60).map((h) => (h.step === roll ? { ...h, ratchet: pick(r, [2, 3]) } : h));
      if (busy > 0.5) {
        const second = pick(r, [3, 10, 11]);
        hats[second] = { ...hats[second], ratchet: 2 };
      }
      return {
        'kick-808': merge(at([0], 120), at([pick(r, [6, 7]), pick(r, [10, 11])], 105), maybe(r, [3, 14], busy * 0.5, 90, 110)),
        'snare': at([8], 115),
        'clap': at([8], 95),
        'hihat-c': hats,
        'hihat-o': maybe(r, [12], busy * 0.4, 60, 80),
      };
    },
  },
  {
    id: 'phonk', name: 'Drift phonk', genre: 'Phonk', bpm: 140, swing: 0,
    build: (r, busy) => {
      const hats = sixteenths(r, 85, 55);
      hats[15] = { ...hats[15], ratchet: 3 };
      return {
        'kick-808': merge(at([0, 10], 120), maybe(r, [3, 6, 7], 0.3 + busy * 0.4, 95, 115)),
        'snare': at([8], 115),
        'clap': at([8], 100),
        'hihat-c': hats,
        'cowbell': merge(at([0, 3, 6], 100), maybe(r, [10, 12, 14], 0.3 + busy * 0.5, 85, 100)),
      };
    },
  },
  {
    id: 'dnb', name: 'Drum & bass', genre: 'Drum & Bass', bpm: 174, swing: 0,
    build: (r, busy) => ({
      'kick': merge(at([0, 10], 118), maybe(r, [3, 13], busy * 0.4, 85, 100)),
      'snare': merge(at([4, 12], 115), maybe(r, [7, 9, 15], 0.2 + busy * 0.5, 35, 55)),
      'hihat-c': merge(at([0, 2, 4, 6, 8, 10, 12, 14], 85), maybe(r, [1, 5, 9, 13], busy * 0.6, 45, 60)),
      'hihat-o': maybe(r, [6, 14], 0.3 + busy * 0.3, 65, 80),
      'ride': maybe(r, [2, 6, 10, 14], busy * 0.4, 50, 65),
    }),
  },
  {
    id: 'rock', name: 'Rock', genre: 'Rock', bpm: 118, swing: 0,
    build: (r, busy) => ({
      'kick': merge(at([0, 8], 115), maybe(r, [6, 10, 14], 0.3 + busy * 0.4, 95, 110)),
      'snare': merge(at([4, 12], 115), maybe(r, [15], busy * 0.4, 40, 60)),
      'hihat-c': at([0, 2, 4, 6, 8, 10, 12, 14], 90),
      'hihat-o': maybe(r, [14], busy * 0.4, 70, 85),
      'crash': at([0], 95),
    }),
  },
  {
    id: 'lofi', name: 'Lo-fi', genre: 'Lo-Fi', bpm: 82, swing: 0.28,
    build: (r, busy) => ({
      'kick': merge(at([0], 100), at([pick(r, [7, 9, 10])], 85), maybe(r, [13, 15], busy * 0.4, 70, 85)),
      'snare-brush': at([4, 12], 95),
      'rim': maybe(r, [6, 14], 0.2 + busy * 0.3, 45, 65),
      // Hats that don't always play: the loose, human feel of the style
      'hihat-c': [0, 2, 4, 6, 8, 10, 12, 14].map((step) => ({ step, velocity: 55 + Math.round(r() * 20), chance: step % 4 === 0 ? 1 : 0.75 })),
      'shaker': maybe(r, [1, 3, 5, 7, 9, 11, 13, 15], busy * 0.6, 30, 45),
    }),
  },
  {
    id: 'garage', name: 'UK garage', genre: 'Garage', bpm: 132, swing: 0.3,
    build: (r, busy) => ({
      'kick': merge(at([0], 115), at([pick(r, [10, 11])], 105), maybe(r, [7, 14], busy * 0.4, 90, 105)),
      'snare': at([4, 12], 105),
      'clap': maybe(r, [4, 12], 0.5, 80, 95),
      'hihat-c': merge(at([2, 6, 10, 14], 85), maybe(r, [3, 7, 11, 15], 0.3 + busy * 0.5, 45, 65)),
      'rim': maybe(r, [5, 9, 13], busy * 0.5, 55, 75),
      'shaker': busy > 0.5 ? sixteenths(r, 55, 30) : [],
    }),
  },
  {
    id: 'dembow', name: 'Dembow', genre: 'Reggaeton', bpm: 96, swing: 0,
    build: (r, busy) => ({
      'kick': at([0, 4, 8, 12], 115),
      'snare': at([3, 6, 11, 14], 100),
      'hihat-c': merge(at([0, 2, 4, 6, 8, 10, 12, 14], 70), maybe(r, [1, 5, 9, 13], busy * 0.5, 40, 55)),
      'rim': maybe(r, [7, 15], busy * 0.4, 55, 75),
      'shaker': busy > 0.6 ? sixteenths(r, 50, 30) : [],
    }),
  },
  {
    id: 'afro', name: 'Afro house', genre: 'Afro', bpm: 122, swing: 0.08,
    build: (r, busy) => ({
      'kick': at([0, 4, 8, 12], 110),
      'clap': maybe(r, [4, 12], 0.6, 80, 95),
      // Son clave (3-2) on the clave, congas talking around it
      'clave': at([0, 3, 6, 10, 12], 90),
      'conga-hi': merge(at([2, 7, 10], 85), maybe(r, [5, 13, 15], 0.3 + busy * 0.5, 60, 80)),
      'conga-lo': merge(at([6, 14], 90), maybe(r, [3, 11], busy * 0.5, 60, 80)),
      'shaker': sixteenths(r, 65, 40),
      'hihat-o': maybe(r, [2, 6, 10, 14], busy * 0.6, 55, 70),
    }),
  },
];

const STYLES_BY_ID = new Map(DRUM_STYLES.map((s) => [s.id, s]));

/** A new pattern in a style. `busy` 0–1 sets how many optional hits appear. */
export function generateDrumPattern(styleId: string, seed: number, busy = 0.5, name?: string): DrumPattern {
  const style = STYLES_BY_ID.get(styleId) ?? DRUM_STYLES[0];
  const rand = seededRandom(seed);
  const hits = style.build(rand, Math.max(0, Math.min(1, busy)));
  return patternFromHits(name ?? style.name, style.genre, 16, style.swing, hits);
}

// ─── Variations ───────────────────────────────────────────────────────────────

/** Steps that carry the groove and aren't moved by a variation. */
function isAnchor(voice: DrumVoiceType, step: number): boolean {
  if ((voice === 'kick' || voice === 'kick-808') && step === 0) return true;
  if ((voice === 'snare' || voice === 'clap' || voice === 'snare-808' || voice === 'snare-brush') && step % 8 === 4) return true;
  return false;
}

/**
 * The same groove, played a little differently: some optional hits dropped,
 * a few ghost notes added next to existing ones, velocities nudged. The
 * kick on one and the backbeat stay where they are. `amount` 0–1.
 */
export function varyPattern(p: DrumPattern, seed: number, amount = 0.35, name?: string): DrumPattern {
  const rand = seededRandom(seed);
  const hits = hitsOf(p);
  const out: Partial<Record<DrumVoiceType, HitSpec[]>> = {};
  for (const [voice, list] of Object.entries(hits) as [DrumVoiceType, HitSpec[]][]) {
    const kept = list
      .filter((h) => isAnchor(voice, h.step) || rand() > amount * 0.3)
      .map((h) => ({ ...h, velocity: Math.max(1, Math.min(127, (h.velocity ?? 100) + Math.round((rand() - 0.5) * 24 * amount))) }));
    // Ghost notes beside existing hits
    const taken = new Set(kept.map((h) => h.step));
    for (const h of list) {
      const next = (h.step + 1) % p.stepCount;
      if (!taken.has(next) && rand() < amount * 0.25) {
        kept.push({ step: next, velocity: 40 + Math.round(rand() * 25) });
        taken.add(next);
      }
    }
    out[voice] = kept.sort((a, b) => a.step - b.step);
  }
  return patternFromHits(name ?? `${p.name} (variation)`, p.genre === 'User' ? 'User' : p.genre, p.stepCount, p.swing, out);
}

// ─── Fills ────────────────────────────────────────────────────────────────────

export type FillKind = 'snare-roll' | 'toms' | 'build' | 'stutter';
export const FILL_KINDS: FillKind[] = ['snare-roll', 'toms', 'build', 'stutter'];
export const FILL_NAMES: Record<FillKind, string> = {
  'snare-roll': 'Snare roll', toms: 'Tom run', build: 'Build-up', stutter: 'Stutter',
};

/**
 * A fill: the pattern's groove up to the last beat or two of the bar, then a
 * snare roll, a tom run, a build or a stutter. `barSteps` is the bar's length
 * in sixteenths (16 in 4/4, 12 in 3/4), so the fill lands at the end of the
 * bar whatever the meter. `kind` defaults to one picked by the seed.
 */
export function makeFill(p: DrumPattern, seed: number, opts: { barSteps?: number; kind?: FillKind; name?: string } = {}): DrumPattern {
  const rand = seededRandom(seed);
  const barSteps = Math.max(4, Math.min(p.stepCount, opts.barSteps ?? 16));
  const kind = opts.kind ?? pick(rand, FILL_KINDS);
  const zone = kind === 'stutter' ? 4 : rand() < 0.5 ? 4 : 8;
  const from = barSteps - zone;

  // Keep the groove before the fill; inside it, only the kick on its first
  // step. A fill is one bar long, so anything after the bar is dropped.
  const base = hitsOf(p);
  const out: Partial<Record<DrumVoiceType, HitSpec[]>> = {};
  for (const [voice, list] of Object.entries(base) as [DrumVoiceType, HitSpec[]][]) {
    out[voice] = list.filter((h) => h.step < from || (h.step === from && (voice === 'kick' || voice === 'kick-808')));
  }
  const add = (voice: DrumVoiceType, hit: HitSpec) => { out[voice] = [...(out[voice] ?? []).filter((h) => h.step !== hit.step), hit]; };
  const ramp = (i: number) => Math.round(60 + (60 * i) / Math.max(1, zone - 1));

  for (let i = 0; i < zone; i++) {
    const step = from + i;
    switch (kind) {
      case 'snare-roll':
        add('snare', { step, velocity: ramp(i), ratchet: i >= zone - 2 ? 2 : 1 });
        break;
      case 'toms': {
        const voice: DrumVoiceType = i < zone / 3 ? 'tom-hi' : i < (2 * zone) / 3 ? 'tom-mid' : 'tom-lo';
        add(voice, { step, velocity: 95 + Math.round(rand() * 20) });
        if (i === zone - 1) add('kick', { step, velocity: 110 });
        break;
      }
      case 'build':
        // Eighths, then sixteenths, louder all the way
        if (i < zone / 2 ? i % 2 === 0 : true) add('snare', { step, velocity: ramp(i) });
        break;
      case 'stutter':
        add(i % 2 === 0 ? 'kick' : 'snare', { step, velocity: 105, ratchet: i === zone - 1 ? 3 : 1 });
        break;
    }
  }
  for (const v of Object.keys(out) as DrumVoiceType[]) out[v] = out[v]!.sort((a, b) => a.step - b.step);
  return patternFromHits(opts.name ?? `${p.name} fill`, p.genre === 'User' ? 'User' : p.genre, p.stepCount, p.swing, out);
}
