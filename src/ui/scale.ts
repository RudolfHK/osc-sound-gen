/**
 * Interface scale (Settings → Appearance).
 *
 * The desktop app zooms the whole page like the browser's own zoom, which
 * needs nothing else. In a browser the page sets CSS `zoom` on <html>; there,
 * pointer positions and element rectangles are in zoomed (screen) pixels
 * while layout — canvas sizes, `position: fixed` offsets — stays in CSS
 * pixels, so code that turns a mouse position into a beat or a popup position
 * converts through `toLayout` / `localPoint`.
 */

interface DesktopZoom { setZoomFactor?: (f: number) => void }
const desktop = (window as unknown as { oscDesktop?: DesktopZoom }).oscDesktop;

let cssZoom = 1;

export function applyUiScale(scale: number): void {
  const s = Math.min(1.5, Math.max(0.9, scale || 1));
  if (desktop?.setZoomFactor) {
    desktop.setZoomFactor(s);
    return;
  }
  cssZoom = s;
  document.documentElement.style.zoom = s === 1 ? '' : String(s);
  // Viewport units are zoomed too; sizes like "92vh" divide by this to still fit
  document.documentElement.style.setProperty('--ui-zoom', String(s));
}

/** Screen pixels → CSS pixels (identity at 100 % or in the desktop app). */
export function toLayout(px: number): number {
  return px / cssZoom;
}

/** Pointer position inside an element, in the element's own CSS pixels. */
export function localPoint(e: { clientX: number; clientY: number }, el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: (e.clientX - r.left) / cssZoom, y: (e.clientY - r.top) / cssZoom };
}

/** Backing-store scale for canvases: sharp at any UI scale, capped at 2× for speed. */
export function canvasPixelRatio(): number {
  return Math.min(2, (window.devicePixelRatio || 1) * cssZoom);
}
