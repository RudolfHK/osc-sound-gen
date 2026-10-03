/**
 * Live playhead position, kept outside React state.
 *
 * The position changes every animation frame during playback. Storing it in
 * the app reducer re-rendered the entire component tree 60 times a second and
 * triggered a full localStorage write each frame. Canvases subscribe here and
 * redraw themselves; only the small position readout re-renders.
 */

import { useSyncExternalStore } from 'react';

type Listener = (beat: number) => void;

let current = 0;
const listeners = new Set<Listener>();

export function getPlayhead(): number {
  return current;
}

export function setPlayhead(beat: number): void {
  if (beat === current) return;
  current = beat;
  for (const l of listeners) l(beat);
}

export function subscribePlayhead(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** React hook for components that genuinely need to re-render on every move. */
export function usePlayhead(): number {
  return useSyncExternalStore(
    (cb) => subscribePlayhead(() => cb()),
    getPlayhead,
    getPlayhead,
  );
}
