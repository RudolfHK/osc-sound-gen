import { SNAP_BEATS, makeNoteId } from '../utils/music';
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
        id: `${makeNoteId()}-a${i}`,
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
 * Cached expansion. The sequencer calls this every time it reconfigures, and
 * re-expanding a dense 32-bar part on each call would show up as jitter.
 */
const cache = new Map<string, { key: string; notes: SequencerNote[] }>();

export function expandArpCached(
  trackId: string,
  notes: SequencerNote[],
  arp: ArpSettings,
): SequencerNote[] {
  if (!arp.enabled) return notes;

  // Note identity plus the arp settings fully determine the output, except for
  // 'random' mode which must re-roll each time.
  const key = arp.mode === 'random'
    ? `random-${Math.random()}`
    : `${notes.length}:${arp.rate}:${arp.mode}:${arp.octaves}:${arp.gate}:` +
      notes.map((n) => `${n.midiNote},${n.startBeat},${n.durationBeats},${n.velocity}`).join('|');

  const hit = cache.get(trackId);
  if (hit && hit.key === key) return hit.notes;

  const expanded = expandArp(notes, arp);
  cache.set(trackId, { key, notes: expanded });
  return expanded;
}

export function clearArpCache(): void {
  cache.clear();
}
