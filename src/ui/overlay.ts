/**
 * Which overlays (dialogs, menus, popovers) are open. While any is, the app's
 * global keyboard shortcuts stand down — Space must not start playback behind
 * the export dialog, Delete must not delete a clip behind a menu.
 */
import { useEffect } from 'react';

let open = 0;

export function isOverlayOpen(): boolean {
  return open > 0;
}

/** Register an open overlay for as long as the calling component is mounted. */
export function useOverlay(active = true): void {
  useEffect(() => {
    if (!active) return;
    open++;
    return () => { open = Math.max(0, open - 1); };
  }, [active]);
}
