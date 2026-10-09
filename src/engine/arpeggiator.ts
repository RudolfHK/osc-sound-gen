import { SNAP_BEATS } from '../utils/music';
import type { ArpSettings, SequencerNote } from '../utils/music';

/**
 * Notes that sound together, treated as one chord for the arpeggiator.
 * Two notes belong to the same chord when their spans overlap.
 */
interface Chord {
  startBeat: number;
  endBeat: number;
  notes: SequencerNote[];
}

function groupIntoChords(notes: SequencerNote[]): Chord[] {
  if (notes.length === 0) return [];
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat);
  const chords: Chord[] = [];

  for (const note of sorted) {
    const end = note.startBeat + note.durationBeats;
    const current = chords[chords.length - 1];
    // Overlaps the chord being built? Join it and extend the window.
    if (current && note.startBeat < current.endBeat - 1e-6) {
      current.notes.push(note);
      current.endBeat = Math.max(current.endBeat, end);
    } else {
      chords.push({ startBeat: note.startBeat, endBeat: end, notes: [note] });
    }
  }
  return chords;
}

/** Pitch sequence one cycle of the arp walks through, before octave stacking. */
function orderPitches(notes: SequencerNote[], mode: ArpSettings['mode']): number[] {
  const asPlayed = notes.map((n) => n.midiNote);
  const ascending = [...new Set(asPlayed)].sort((a, b) => a - b);

  switch (mode) {
    case 'up':
      return ascending;
    case 'down':
      return [...ascending].reverse();
    case 'updown':
      // Don't repeat the turnaround notes — that is what makes it sound like a
      // pendulum rather than a stutter at each end.
      return ascending.length > 2
        ? [...ascending, ...ascending.slice(1, -1).reverse()]
        : ascending;
    case 'downup': {
      const desc = [...ascending].reverse();
      return desc.length > 2 ? [...desc, ...desc.slice(1, -1).reverse()] : desc;
    }
    case 'order':
      return [...new Set(asPlayed)];
    case 'random':
      return ascending;  // order is chosen per step at expansion time
    default:
      return ascending;
  }
}

/**
 * Expand a track's notes into arpeggiated steps.
 *
 * Held chords become repeating patterns of short notes, which is how driving
 * electronic parts are written: draw four long notes, let the arp turn them
 * into a bar of sixteenths.
 */
export function expandArp(notes: SequencerNote[], arp: ArpSettings): SequencerNote[] {
  if (!arp.enabled || notes.length === 0) return notes;

  const stepBeats = SNAP_BEATS[arp.rate];
  if (!stepBeats || stepBeats <= 0) return notes;

  const octaves = Math.max(1, Math.min(4, Math.round(arp.octaves)));
  const gate = Math.max(0.05, Math.min(1, arp.gate));
  const out: SequencerNote[] = [];

  for (const chord of groupIntoChords(notes)) {
    const base = orderPitches(chord.notes, arp.mode);
    if (base.length === 0) continue;

    // Stack the cycle up through the requested octave range
    const cycle: number[] = [];
    for (let o = 0; o < octaves; o++) {
      for (const p of base) cycle.push(p + o * 12);
    }

    // Velocity follows the loudest note of the chord so dynamics survive
    const velocity = Math.max(...chord.notes.map((n) => n.velocity));
    const span = chord.endBeat - chord.startBeat;
    const stepCount = Math.max(1, Math.floor(span / stepBeats + 1e-6));

    for (let i = 0; i < stepCount; i++) {
      const pitch = arp.mode === 'random'
        ? cycle[Math.floor(Math.random() * cycle.length)]
        : cycle[i % cycle.length];
      if (pitch === undefined) continue;

      out.push({
        // Derived from the chord, so re-expanding yields the same ids
        id: `${chord.notes[0].id}-a${i}`,
        midiNote: Math.max(0, Math.min(127, pitch)),
        startBeat: chord.startBeat + i * stepBeats,
        durationBeats: stepBeats * gate,
        velocity,
      });
    }
  }

  return out;
}

/**
 * Cached expansion, one slot per track and pattern. The scheduler asks for a
 * clip's notes on every tick, so a hit must be cheap: patterns and arp settings
 * are immutable in the store (an edit makes new objects), which means object
 * identity is the cache key. That also keeps 'random' mode stable — it re-rolls
 * when the part or the settings change, not on every scheduler tick.
 */
const cache = new Map<string, { notes: SequencerNote[]; arp: ArpSettings; expanded: SequencerNote[] }>();

export function expandArpCached(
  /** Cache slot — one per track and pattern. */
  slot: string,
  notes: SequencerNote[],
  arp: ArpSettings,
): SequencerNote[] {
  if (!arp.enabled) return notes;
  const hit = cache.get(slot);
  if (hit && hit.notes === notes && hit.arp === arp) return hit.expanded;
  const expanded = expandArp(notes, arp);
  cache.set(slot, { notes, arp, expanded });
  return expanded;
}

/** Drop slots for tracks and patterns that no longer exist. */
export function pruneArpCache(liveSlots: Set<string>): void {
  for (const slot of cache.keys()) if (!liveSlots.has(slot)) cache.delete(slot);
}
