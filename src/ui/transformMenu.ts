import type { MenuItem } from './ContextMenu';
import type { NoteTransform } from '../utils/transforms';

/**
 * The transform menu, shared by the clip menu, the clip-selection menu and
 * the piano roll. `speed` leaves out half/double speed (several clips at once
 * would each need their own length change).
 */
export function transformItems(apply: (t: NoteTransform) => void, { speed = true } = {}): MenuItem[] {
  const seed = () => Date.now() & 0x7fffffff;
  return [
    { label: 'Transpose up a semitone', onSelect: () => apply({ op: 'transpose', semitones: 1 }) },
    { label: 'Transpose down a semitone', onSelect: () => apply({ op: 'transpose', semitones: -1 }) },
    { label: 'Transpose up an octave', onSelect: () => apply({ op: 'transpose', semitones: 12 }) },
    { label: 'Transpose down an octave', onSelect: () => apply({ op: 'transpose', semitones: -12 }) },
    { divider: true, label: '' },
    { label: 'Reverse', hint: 'Play it backwards in time', onSelect: () => apply({ op: 'reverse' }) },
    { label: 'Invert', hint: 'Turn the melody upside down', onSelect: () => apply({ op: 'invert' }) },
    ...(speed ? [
      { label: 'Half speed', hint: 'Twice as long', onSelect: () => apply({ op: 'stretch', factor: 2 }) },
      { label: 'Double speed', hint: 'Half as long', onSelect: () => apply({ op: 'stretch', factor: 0.5 }) },
    ] : []),
    { divider: true, label: '' },
    { label: 'Humanize', hint: 'Small changes to timing and velocity', onSelect: () => apply({ op: 'humanize', amount: 0.5, seed: seed() }) },
    { label: 'Legato', hint: 'Each note lasts until the next', onSelect: () => apply({ op: 'legato' }) },
  ];
}
