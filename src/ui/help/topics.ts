import type { MainView } from '../../engine/oscillator';
import type { DockTab } from '../Dock';

/**
 * Which section of the user guide explains what's on screen — F1 opens the
 * guide there. Section titles are the guide's "## " headings.
 */
export function helpTopicFor(view: MainView, dockTab: DockTab | null): string {
  if (view === 'lab') return 'The Oscillator Lab';
  switch (dockTab) {
    case 'editor': return 'The Editor';
    case 'mixer': return 'The Mixer';
    case 'instruments': return 'The Instrument Library';
    case 'fx': return 'Master Effects';
    default: return 'The Arrangement';
  }
}
