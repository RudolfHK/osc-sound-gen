/**
 * Which area of the app keyboard shortcuts act on.
 *
 * Delete, Ctrl+C/V and friends mean different things in the arrangement
 * (clips) and the editor (notes). The area clicked last owns them — the same
 * convention DAWs use for their arrange/editor split.
 */

export type FocusZone = 'arrange' | 'editor' | 'other';

let zone: FocusZone = 'arrange';

export function getFocusZone(): FocusZone {
  return zone;
}

export function setFocusZone(z: FocusZone): void {
  zone = z;
}

/** True when a key event is going into a text field and shortcuts must stay out of the way. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    // Sliders and checkboxes don't take text, so shortcuts can pass through them
    return !['range', 'checkbox', 'radio', 'button'].includes(target.type);
  }
  return false;
}
