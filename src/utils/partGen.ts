/**
 * Parts written from the chord track: bass lines, pads, arpeggios and stabs
 * in a handful of styles. Pure functions of the chords, the bar length and a
 * seed, so the same request always writes the same part.
 *
 * Rhythms sit on the song's bar lines, not on the chord changes, so a part
 * stays in time with the drums however the chords fall.
 */
import { QUALITIES, type ChordMark } from './harmony';
import { seededRandom } from './rhythm';
import type { SequencerNote } from './music';

export type PartKind = 'bass' | 'pad' | 'arp' | 'stabs';
export type PartNote = Omit<SequencerNote, 'id'>;
type Chord = Pick<ChordMark, 'beat' | 'root' | 'quality' | 'bass'>;

export interface PartStyle {
  id: string;
  kind: PartKind;
  name: string;
  hint: string;
  /** The instrument a new track for this part starts with. */
  preset: string;
}

export const PART_KINDS: { kind: PartKind; name: string }[] = [
  { kind: 'bass', name: 'Bass' },
  { kind: 'pad', name: 'Pad' },
  { kind: 'arp', name: 'Arpeggio' },
  { kind: 'stabs', name: 'Stabs' },
];

export const PART_STYLES: PartStyle[] = [
  { id: 'bass-roots', kind: 'bass', name: 'Roots', hint: 'The root, held through each bar', preset: 'bass-sub' },
  { id: 'bass-pulse', kind: 'bass', name: 'Eighth pulse', hint: 'Driving eighths on the root', preset: 'bass-saw' },
  { id: 'bass-octaves', kind: 'bass', name: 'Octave bounce', hint: 'Root and octave in eighths', preset: 'bass-fm' },
  { id: 'bass-offbeat', kind: 'bass', name: 'Offbeat', hint: 'Between the kicks, house style', preset: 'bass-house' },
  { id: 'bass-groove', kind: 'bass', name: 'Groove', hint: 'Root, fifth and octave with pushes', preset: 'bass-pluck' },
  { id: 'bass-walk', kind: 'bass', name: 'Walking', hint: 'Quarter notes stepping to the next chord', preset: 'bgtr-finger' },

  { id: 'pad-held', kind: 'pad', name: 'Held', hint: 'Each chord held, voiced smoothly', preset: 'pad-warm' },
  { id: 'pad-bars', kind: 'pad', name: 'Every bar', hint: 'Restruck on each bar line', preset: 'pad-strings' },
  { id: 'pad-open', kind: 'pad', name: 'Open voicing', hint: 'Spread wide, for a bigger sound', preset: 'pad-cinematic' },
  { id: 'pad-pulse', kind: 'pad', name: 'Quarter pulse', hint: 'Chords on every beat', preset: 'keys-epiano' },

  { id: 'arp-up', kind: 'arp', name: 'Up', hint: 'Sixteenths climbing the chord', preset: 'pluck-digital' },
  { id: 'arp-updown', kind: 'arp', name: 'Up and down', hint: 'Sixteenths up then down', preset: 'pluck-analog' },
  { id: 'arp-down', kind: 'arp', name: 'Down', hint: 'Eighths falling through the chord', preset: 'pluck-bell-syn' },
  { id: 'arp-broken', kind: 'arp', name: 'Broken chord', hint: 'Root, fifth, octave, third in eighths', preset: 'keys-epiano' },
  { id: 'arp-random', kind: 'arp', name: 'Random', hint: 'Chord tones in a seeded order', preset: 'pluck-glass-syn' },

  { id: 'stab-offbeat', kind: 'stabs', name: 'Offbeats', hint: 'Short chords on every “and”', preset: 'pluck-house' },
  { id: 'stab-charleston', kind: 'stabs', name: 'Charleston', hint: 'On one and the “and” of two', preset: 'keys-epiano' },
  { id: 'stab-tresillo', kind: 'stabs', name: '3-3-2', hint: 'The syncopated three-three-two', preset: 'pluck-house' },
  { id: 'stab-backbeat', kind: 'stabs', name: 'Backbeat', hint: 'Short chords on two and four', preset: 'keys-clav' },
];

export function partStyle(id: string): PartStyle {
  return PART_STYLES.find((s) => s.id === id) ?? PART_STYLES[0];
}

export interface PartRequest {
  styleId: string;
  /** Song range to fill, in beats. */
  from: number;
  to: number;
  beatsPerBar: number;
  /** Varies the choices a style leaves open (arpeggio order, walks, small velocity changes). */
  seed?: number;
  /** Octaves up or down from the style's usual register. */
  octave?: number;
}

/** Spans of the chords that sound in [from, to), clipped to it. */
export function chordSegments(chords: Chord[], from: number, to: number): (Chord & { start: number; end: number })[] {
  const sorted = [...chords].sort((a, b) => a.beat - b.beat);
  const out: (Chord & { start: number; end: number })[] = [];
  sorted.forEach((c, i) => {
    const end = Math.min(to, sorted[i + 1]?.beat ?? Infinity);
    const start = Math.max(from, c.beat);
    if (end - start > 1e-6) out.push({ ...c, start, end });
  });
  return out;
}

/**
 * Write a part over the chords. Notes are in song beats; nothing is written
 * before the first chord or where the range has none.
 */
export function generatePart(chords: Chord[], req: PartRequest): PartNote[] {
  const style = partStyle(req.styleId);
  const segs = chordSegments(chords, req.from, req.to);
  if (!segs.length || req.to <= req.from) return [];
  const rnd = seededRandom((req.seed ?? 1) * 7919 + 17);
  const shift = 12 * Math.max(-2, Math.min(2, Math.round(req.octave ?? 0)));
  const ctx: Ctx = { segs, req, rnd, shift, bar: Math.max(1, req.beatsPerBar) };
  const notes = style.kind === 'bass' ? bass(style.id, ctx)
    : style.kind === 'pad' ? pad(style.id, ctx)
      : style.kind === 'arp' ? arp(style.id, ctx)
        : stabs(style.id, ctx);
  return notes
    .filter((n) => n.durationBeats > 0.02 && n.midiNote >= 0 && n.midiNote <= 127)
    .map((n) => ({ ...n, startBeat: round(n.startBeat), durationBeats: round(n.durationBeats), velocity: clampVel(n.velocity) }))
    .sort((a, b) => a.startBeat - b.startBeat || a.midiNote - b.midiNote);
}

// ─── Shared ───────────────────────────────────────────────────────────────────

interface Ctx {
  segs: (Chord & { start: number; end: number })[];
  req: PartRequest;
  rnd: () => number;
  shift: number;
  bar: number;
}

const round = (x: number) => Math.round(x * 1e4) / 1e4;
const clampVel = (v: number) => Math.max(1, Math.min(127, Math.round(v)));
const mod12 = (n: number) => ((n % 12) + 12) % 12;

/** The pitch in [low, low + 12) with pitch class `pc`. */
const inOctave = (pc: number, low: number) => low + mod12(pc - low);

/** A small seeded nudge so repeated notes don't all land at one velocity. */
const vary = (ctx: Ctx, v: number) => v + Math.round((ctx.rnd() - 0.5) * 8);

/**
 * Onsets on the song's bar grid: for every bar touching the range, each
 * offset in `hits` (beats into the bar) that falls inside the range and on a
 * chord. The duration is cut at the next chord change and the range's end.
 */
function grid(ctx: Ctx, hits: { at: number; len: number; accent?: boolean }[]): { t: number; len: number; seg: Ctx['segs'][number]; accent: boolean; index: number }[] {
  const { req, bar, segs } = ctx;
  const out: { t: number; len: number; seg: Ctx['segs'][number]; accent: boolean; index: number }[] = [];
  const firstBar = Math.floor(req.from / bar) * bar;
  for (let b = firstBar; b < req.to - 1e-9; b += bar) {
    hits.forEach((h, index) => {
      if (h.at >= bar - 1e-9) return; // a 4/4 figure in a shorter bar
      const t = b + h.at;
      if (t < req.from - 1e-9 || t >= req.to - 1e-9) return;
      const seg = segs.find((sg) => t >= sg.start - 1e-9 && t < sg.end - 1e-9);
      if (!seg) return;
      out.push({ t, len: Math.min(h.len, seg.end - t, req.to - t), seg, accent: !!h.accent, index });
    });
  }
  return out;
}

/** Every `step` beats across the bar. */
const every = (bar: number, step: number, len: number, offset = 0) =>
  Array.from({ length: Math.ceil((bar - offset) / step) }, (_, i) => ({ at: offset + i * step, len, accent: (offset + i * step) % 1 === 0 }));

/** The segments, split at bar lines (a long chord restruck each bar). */
function perBar(ctx: Ctx): { start: number; end: number; seg: Ctx['segs'][number] }[] {
  const out: { start: number; end: number; seg: Ctx['segs'][number] }[] = [];
  for (const seg of ctx.segs) {
    let s = seg.start;
    while (s < seg.end - 1e-9) {
      const nextBar = (Math.floor(s / ctx.bar + 1e-9) + 1) * ctx.bar;
      const e = Math.min(seg.end, nextBar);
      out.push({ start: s, end: e, seg });
      s = e;
    }
  }
  return out;
}

// ─── Bass ─────────────────────────────────────────────────────────────────────

/** Bass register: the lowest note of the chord (its slash bass) between A1 and G♯2. */
const bassNote = (c: Chord, shift: number) => inOctave(c.bass ?? c.root, 33) + shift;
const fifthAbove = (c: Chord) => {
  const iv = QUALITIES[c.quality].intervals;
  return iv.find((i) => i === 7 || i === 6 || i === 8) ?? 7;
};

function bass(id: string, ctx: Ctx): PartNote[] {
  const { shift, bar } = ctx;
  const note = (t: number, midi: number, len: number, v: number): PartNote => ({ midiNote: midi, startBeat: t, durationBeats: len, velocity: vary(ctx, v) });

  if (id === 'bass-roots') {
    return perBar(ctx).map((p) => note(p.start, bassNote(p.seg, shift), p.end - p.start - 0.05, 100));
  }
  if (id === 'bass-pulse') {
    return grid(ctx, every(bar, 0.5, 0.42)).map((g) => note(g.t, bassNote(g.seg, shift), g.len, g.accent ? 104 : 88));
  }
  if (id === 'bass-octaves') {
    return grid(ctx, every(bar, 0.5, 0.4)).map((g) => note(g.t, bassNote(g.seg, shift) + (g.index % 2 ? 12 : 0), g.len, g.index % 2 ? 92 : 104));
  }
  if (id === 'bass-offbeat') {
    return grid(ctx, every(bar, 1, 0.42, 0.5)).map((g) => note(g.t, bassNote(g.seg, shift), g.len, 100));
  }
  if (id === 'bass-groove') {
    // root · push · fifth · root · octave · fifth
    const figure = [
      { at: 0, len: 0.5, accent: true }, { at: 0.75, len: 0.25 }, { at: 1.5, len: 0.5 },
      { at: 2.5, len: 0.5 }, { at: 3, len: 0.25 }, { at: 3.5, len: 0.42 },
    ];
    const pitch = [0, 0, 'fifth', 0, 12, 'fifth'] as const;
    return grid(ctx, figure).map((g) => {
      const p = pitch[g.index];
      const root = bassNote(g.seg, shift);
      return note(g.t, root + (p === 'fifth' ? fifthAbove(g.seg) : p), g.len, g.accent ? 108 : 92);
    });
  }
  // Walking: chord tones on the beats, and the last beat before a change
  // leans into the next root by a semitone
  const hits = grid(ctx, every(bar, 1, 0.9));
  const out: PartNote[] = [];
  let prev = -1;
  hits.forEach((g, i) => {
    const root = bassNote(g.seg, shift);
    const next = hits[i + 1];
    const changesNext = next && next.seg !== g.seg;
    let midi: number;
    if (changesNext) {
      // A semitone below or above the next root, whichever is nearer, but not a repeat
      const target = bassNote(next.seg, shift);
      const [near, far] = [target - 1, target + 1].sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev));
      midi = near !== prev ? near : far;
    } else if (g.t - g.seg.start < 1e-6) {
      midi = root;
    } else {
      // A chord tone near the last note: one of the two closest, so the line walks
      const pcs = QUALITIES[g.seg.quality].intervals.map((iv) => mod12(g.seg.root + iv));
      const near: number[] = [];
      for (let m = 31 + shift; m <= 47 + shift; m++) if (m !== prev && pcs.includes(mod12(m))) near.push(m);
      near.sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev));
      midi = near[ctx.rnd() < 0.7 ? 0 : 1] ?? root;
    }
    prev = midi;
    out.push(note(g.t, midi, g.len, g.t % bar === 0 ? 104 : 92));
  });
  return out;
}

// ─── Voicing ──────────────────────────────────────────────────────────────────

/** The chord's tones as pitch classes, at most four (a ninth chord drops its fifth). */
function voicingTones(c: Chord): number[] {
  let iv = QUALITIES[c.quality].intervals;
  if (iv.length > 4) iv = iv.filter((i) => i !== 7);
  return iv.slice(0, 4).map((i) => mod12(c.root + i));
}

/**
 * Four-note voicings in [low, high] that sound every tone of the chord, with
 * no gap wider than an octave between neighbours. A triad doubles one tone.
 */
function candidates(pcs: number[], low: number, high: number): number[][] {
  const pool: number[] = [];
  for (let m = low; m <= high; m++) if (pcs.includes(mod12(m))) pool.push(m);
  const out: number[][] = [];
  const pick = (from: number, chosen: number[]) => {
    if (chosen.length === 4) {
      if (pcs.every((pc) => chosen.some((m) => mod12(m) === pc))) out.push([...chosen]);
      return;
    }
    for (let i = from; i < pool.length; i++) {
      const last = chosen[chosen.length - 1];
      if (last !== undefined && pool[i] - last > 12) break;
      chosen.push(pool[i]);
      pick(i + 1, chosen);
      chosen.pop();
    }
  };
  pick(0, []);
  return out;
}

/** How far the voices move from one chord to the next. */
function movement(a: number[], b: number[]): number {
  if (a.length === b.length) return a.reduce((s, m, i) => s + Math.abs(m - b[i]), 0);
  return b.reduce((s, m) => s + Math.min(...a.map((x) => Math.abs(x - m))), 0);
}

/**
 * Voice a chord close to the previous voicing, so the parts move by the
 * smallest steps (smooth voice leading), without drifting far from `centre`.
 * A triad prefers to double its root; `span` is the spread to aim for, from
 * lowest to highest note (about 10 semitones is close position).
 */
export function voiceChord(c: Chord, prev: number[] | null, low: number, high: number, centre: number, span = 10): number[] {
  const pcs = voicingTones(c);
  const options = candidates(pcs, low, high);
  if (!options.length) return pcs.map((pc) => inOctave(pc, low));
  const cost = (v: number[]) => {
    const mean = v.reduce((s, m) => s + m, 0) / v.length;
    const doubled = v.filter((m, i) => v.findIndex((x) => mod12(x) === mod12(m)) !== i).map(mod12);
    const badDouble = doubled.some((pc) => pc !== c.root) ? 3 : 0;
    const shape = Math.abs(v[v.length - 1] - v[0] - span) * 0.25 + badDouble;
    return prev ? movement(prev, v) + Math.abs(mean - centre) * 0.3 + shape * 0.5 : Math.abs(mean - centre) + shape;
  };
  return options.reduce((best, v) => (cost(v) < cost(best) ? v : best));
}

/** One voicing per chord segment, each led from the one before. */
function voicings(ctx: Ctx, low: number, high: number, centre: number, span = 10): Map<Ctx['segs'][number], number[]> {
  const out = new Map<Ctx['segs'][number], number[]>();
  let prev: number[] | null = null;
  for (const seg of ctx.segs) {
    const v = voiceChord(seg, prev, low + ctx.shift, high + ctx.shift, centre + ctx.shift, span);
    out.set(seg, v);
    prev = v;
  }
  return out;
}

// ─── Pads ─────────────────────────────────────────────────────────────────────

function pad(id: string, ctx: Ctx): PartNote[] {
  const voiced = id === 'pad-open' ? voicings(ctx, 45, 84, 64, 21) : voicings(ctx, 52, 79, 64);
  const chord = (t: number, len: number, pitches: number[], v: number): PartNote[] =>
    pitches.map((m) => ({ midiNote: m, startBeat: t, durationBeats: len, velocity: vary(ctx, v) }));

  if (id === 'pad-held' || id === 'pad-open') {
    return ctx.segs.flatMap((s) => chord(s.start, s.end - s.start, voiced.get(s)!, 84));
  }
  if (id === 'pad-bars') {
    return perBar(ctx).flatMap((p) => chord(p.start, p.end - p.start - 0.03, voiced.get(p.seg)!, p.start % ctx.bar === 0 ? 88 : 80));
  }
  return grid(ctx, every(ctx.bar, 1, 0.85)).flatMap((g) => chord(g.t, g.len, voiced.get(g.seg)!, g.t % ctx.bar === 0 ? 92 : 78));
}

// ─── Arpeggios ────────────────────────────────────────────────────────────────

function arp(id: string, ctx: Ctx): PartNote[] {
  const voiced = voicings(ctx, 57, 81, 67);
  const rate = id === 'arp-down' || id === 'arp-broken' ? 0.5 : 0.25;
  const hits = grid(ctx, every(ctx.bar, rate, rate * 0.85));
  const out: PartNote[] = [];
  let i = 0;
  let last = -1;
  let seg: Ctx['segs'][number] | null = null;
  for (const g of hits) {
    if (g.seg !== seg) { seg = g.seg; i = 0; }
    // The voicing, low to high
    const tones = [...voiced.get(g.seg)!].sort((a, b) => a - b);
    const n = tones.length;
    let midi: number;
    if (id === 'arp-up') midi = tones[i % n];
    else if (id === 'arp-down') midi = tones[n - 1 - (i % n)];
    else if (id === 'arp-updown') {
      const cycle = Math.max(1, 2 * n - 2);
      const k = i % cycle;
      midi = tones[k < n ? k : cycle - k];
    } else if (id === 'arp-broken') {
      // root, fifth, octave, tenth — from the root nearest the voicing's foot
      const root = inOctave(g.seg.root, tones[0] - 5);
      const third = QUALITIES[g.seg.quality].intervals[1] ?? 4;
      midi = [root, root + fifthAbove(g.seg), root + 12, root + 12 + third][i % 4];
    } else {
      const choices = tones.filter((m) => m !== last);
      midi = choices[Math.floor(ctx.rnd() * choices.length)] ?? tones[0];
    }
    last = midi;
    out.push({ midiNote: midi, startBeat: g.t, durationBeats: g.len, velocity: vary(ctx, g.accent ? 100 : 80) });
    i++;
  }
  return out;
}

// ─── Stabs ────────────────────────────────────────────────────────────────────

function stabs(id: string, ctx: Ctx): PartNote[] {
  const voiced = voicings(ctx, 55, 79, 66);
  const figure = id === 'stab-offbeat' ? every(ctx.bar, 1, 0.3, 0.5)
    : id === 'stab-charleston' ? [{ at: 0, len: 0.45, accent: true }, { at: 1.5, len: 0.45 }]
      : id === 'stab-tresillo' ? [{ at: 0, len: 0.4, accent: true }, { at: 1.5, len: 0.4 }, { at: 3, len: 0.4 }]
        : [{ at: 1, len: 0.25, accent: true }, { at: 3, len: 0.25, accent: true }];
  return grid(ctx, figure).flatMap((g) => voiced.get(g.seg)!.map((m) => ({
    midiNote: m, startBeat: g.t, durationBeats: g.len, velocity: vary(ctx, g.accent ? 100 : 90),
  })));
}

/**
 * Cut a part into clips, one per range (sections), each in its own pattern
 * time. Notes keep to their clip: one that would ring past it is shortened.
 */
export function splitPart(notes: PartNote[], ranges: { start: number; end: number }[]): PartNote[][] {
  return ranges.map((r) => notes
    .filter((n) => n.startBeat >= r.start - 1e-9 && n.startBeat < r.end - 1e-9)
    .map((n) => ({ ...n, startBeat: round(n.startBeat - r.start), durationBeats: round(Math.min(n.durationBeats, r.end - n.startBeat)) })));
}
