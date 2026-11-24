/**
 * Note transforms for a whole clip or a selection of notes: transpose,
 * reverse, invert, half/double speed, humanize, legato. Pure; note ids are
 * kept, so a selection survives the transform.
 */
import type { SequencerNote } from './music';
import { seededRandom } from './rhythm';

export type NoteTransform =
  | { op: 'transpose'; semitones: number }
  | { op: 'reverse' }
  | { op: 'invert' }
  | { op: 'stretch'; factor: number }
  | { op: 'humanize'; amount: number; seed: number }
  | { op: 'legato' };

export const TRANSFORM_LABELS: Record<NoteTransform['op'], string> = {
  transpose: 'Transpose',
  reverse: 'Reverse',
  invert: 'Invert',
  stretch: 'Change speed',
  humanize: 'Humanize',
  legato: 'Legato',
};

/** The undo-step name for a transform ("Half speed", "Transpose +12"). */
export function transformLabel(t: NoteTransform): string {
  if (t.op === 'transpose') return `Transpose ${t.semitones > 0 ? '+' : ''}${t.semitones}`;
  if (t.op === 'stretch') return t.factor > 1 ? 'Half speed' : 'Double speed';
  return TRANSFORM_LABELS[t.op];
}

const clampPitch = (p: number) => Math.max(0, Math.min(127, Math.round(p)));
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Apply a transform to `notes`. Only notes whose id is in `only` change (all
 * of them when it's absent). `lengthBeats` is the pattern's loop length: a
 * whole-pattern reverse mirrors over it, so a looping clip stays in time.
 */
export function transformNotes(
  notes: SequencerNote[],
  t: NoteTransform,
  { lengthBeats, only }: { lengthBeats: number; only?: ReadonlySet<string> },
): SequencerNote[] {
  const affected = only && only.size ? notes.filter((n) => only.has(n.id)) : notes;
  if (!affected.length) return notes;
  const whole = affected.length === notes.length && (!only || !only.size);
  const map = new Map<string, SequencerNote>();

  switch (t.op) {
    case 'transpose':
      for (const n of affected) map.set(n.id, { ...n, midiNote: clampPitch(n.midiNote + t.semitones) });
      break;

    case 'reverse': {
      // Retrograde: mirror in time over the pattern (or the selection's span)
      const from = whole ? 0 : Math.min(...affected.map((n) => n.startBeat));
      const to = whole ? lengthBeats : Math.max(...affected.map((n) => n.startBeat + n.durationBeats));
      for (const n of affected) {
        map.set(n.id, { ...n, startBeat: round(Math.max(0, from + to - (n.startBeat + n.durationBeats))) });
      }
      break;
    }

    case 'invert': {
      // Mirror the pitches around the middle of their range: the highest note
      // becomes the lowest, intervals turn upside down
      const lo = Math.min(...affected.map((n) => n.midiNote));
      const hi = Math.max(...affected.map((n) => n.midiNote));
      for (const n of affected) map.set(n.id, { ...n, midiNote: clampPitch(lo + hi - n.midiNote) });
      break;
    }

    case 'stretch': {
      // Scale time around the start of the pattern (or of the selection)
      const f = Math.max(0.125, Math.min(8, t.factor));
      const from = whole ? 0 : Math.min(...affected.map((n) => n.startBeat));
      for (const n of affected) {
        map.set(n.id, {
          ...n,
          startBeat: round(from + (n.startBeat - from) * f),
          durationBeats: round(Math.max(1 / 64, n.durationBeats * f)),
        });
      }
      break;
    }

    case 'humanize': {
      // Small, repeatable nudges: velocity by up to ±20·amount, timing by up
      // to a 1/64 note·amount. Nothing moves before the pattern start.
      const rand = seededRandom(t.seed);
      const a = Math.max(0, Math.min(1, t.amount));
      for (const n of affected) {
        const dv = Math.round((rand() * 2 - 1) * 20 * a);
        const dt = (rand() * 2 - 1) * 0.0625 * a;
        map.set(n.id, {
          ...n,
          velocity: Math.max(1, Math.min(127, n.velocity + dv)),
          startBeat: round(Math.max(0, n.startBeat + dt)),
        });
      }
      break;
    }

    case 'legato': {
      // Each note lasts until the next note starts (chords end together); the
      // last ones hold to the end of the pattern or selection
      const starts = [...new Set(affected.map((n) => n.startBeat))].sort((x, y) => x - y);
      const end = whole ? lengthBeats : Math.max(...affected.map((n) => n.startBeat + n.durationBeats));
      for (const n of affected) {
        const next = starts.find((s) => s > n.startBeat + 1e-9) ?? end;
        map.set(n.id, { ...n, durationBeats: round(Math.max(1 / 64, next - n.startBeat)) });
      }
      break;
    }
  }

  return notes.map((n) => map.get(n.id) ?? n);
}
