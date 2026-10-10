/**
 * Light and dark appearance.
 *
 * The interface is written against Tailwind's neutral ramp (and four colour
 * ramps). The light theme flips those ramps in CSS (`index.css`), so classes
 * like `bg-neutral-900` and `text-neutral-300` keep their meaning — "a dark
 * surface", "a light label" — in reverse. Canvases can't use CSS variables
 * cheaply, so they ask `gray()` and `ink()` here, which do the same flip.
 */
import { useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';

const KEY = 'osc-theme';
let theme: Theme = read();
const listeners = new Set<() => void>();

function read(): Theme {
  try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

export function getTheme(): Theme {
  return theme;
}

export function setTheme(t: Theme): void {
  if (t === theme) return;
  theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* storage unavailable */ }
  applyTheme();
  for (const l of listeners) l();
}

/** Put the theme on <html> — call once before the first render to avoid a flash. */
export function applyTheme(): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => theme,
    () => theme,
  );
}

// ─── Canvas colours ───────────────────────────────────────────────────────────

/**
 * A grey written for the dark theme, mirrored for the light one: #0d0d0d (a
 * near-black background) becomes #f2f2f2, #737373 (a mid label) stays mid.
 */
export function gray(hex: string): string {
  if (theme === 'dark') return hex;
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h[0] + h[0] : h.slice(0, 2), 16);
  const inv = (255 - v).toString(16).padStart(2, '0');
  return `#${inv}${inv}${inv}`;
}

/** Foreground "ink" at an alpha: white on dark, black on light. */
export function ink(alpha = 1): string {
  return theme === 'dark' ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
}

/** A shade that darkens on dark and lightens on light — for scrims over a canvas. */
export function shade(alpha: number): string {
  return theme === 'dark' ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha})`;
}

/**
 * The accent colours are neon for a black background; on white they'd vanish,
 * so the light theme uses a deeper shade of each.
 */
const LIGHT_ACCENT: Record<string, string> = {
  '#00ff88': '#047857',
  '#ffb000': '#b45309',
  '#00aaff': '#0369a1',
  '#f0f0f0': '#262626',
};

export function accentFor(hex: string, t: Theme = theme): string {
  return t === 'light' ? (LIGHT_ACCENT[hex.toLowerCase()] ?? hex) : hex;
}

/**
 * A user-chosen colour made readable as text on the current background: very
 * bright colours (neon greens, yellows) are deepened in the light theme.
 */
export function readable(hex: string, t: Theme = theme): string {
  if (t === 'dark' || !/^#[0-9a-f]{6}$/i.test(hex)) return accentFor(hex, t);
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lin = (c: number) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  if (lum < 0.35) return hex;
  const k = 0.55;
  const to = (c: number) => Math.round(c * k).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}
