/**
 * Every keyboard shortcut in one table.
 *
 * The global key handler, tooltips, menus and the "?" overlay all read from
 * here, so a shortcut can't be advertised without existing (or exist without
 * being listed). Components attach behaviour with `useShortcuts`.
 *
 * Keys are written as "Mod+Shift+Z": Mod is ⌘ on a Mac and Ctrl elsewhere.
 * Shortcuts with Alt match the physical key (`e.code`), because macOS's
 * Option key turns letters into other characters.
 */
import { useEffect, useRef } from 'react';
import { getFocusZone, isTypingTarget } from './focus';
import { isOverlayOpen } from './overlay';

export type ShortcutScope = 'global' | 'arrange' | 'editor';

export interface ShortcutDef {
  id: string;
  label: string;
  group: 'Transport' | 'File' | 'Edit' | 'View' | 'Help' | 'Arrangement' | 'Editor';
  scope: ShortcutScope;
  keys: string[];
  /** Listed for reference; handled elsewhere (the computer-keyboard piano). */
  docOnly?: boolean;
  /** Stop the browser's own action for these keys even when nothing applies (Ctrl+D bookmarks). */
  always?: boolean;
}

// Commands with no keys (menu-only, like New project) live here too, so the
// desktop menu bar can run them by id.
export const SHORTCUTS: ShortcutDef[] = [
  // ── Transport ──
  { id: 'transport.toggle', label: 'Play / stop', group: 'Transport', scope: 'global', keys: ['Space'] },
  { id: 'transport.home', label: 'Back to the start (loop start first)', group: 'Transport', scope: 'global', keys: ['Home'] },
  { id: 'transport.loop', label: 'Loop on / off', group: 'Transport', scope: 'arrange', keys: ['L'] },
  { id: 'transport.metronome', label: 'Metronome on / off', group: 'Transport', scope: 'arrange', keys: ['K'] },
  // ── File ──
  { id: 'file.new', label: 'New project', group: 'File', scope: 'global', keys: [] },
  { id: 'file.save', label: 'Save', group: 'File', scope: 'global', keys: ['Mod+S'] },
  { id: 'file.saveAs', label: 'Save as…', group: 'File', scope: 'global', keys: ['Mod+Shift+S'] },
  { id: 'file.open', label: 'Open…', group: 'File', scope: 'global', keys: ['Mod+O'] },
  { id: 'file.export', label: 'Export audio / MIDI…', group: 'File', scope: 'global', keys: ['Mod+Shift+E'] },
  // ── Edit ──
  { id: 'edit.undo', label: 'Undo', group: 'Edit', scope: 'global', keys: ['Mod+Z'] },
  { id: 'edit.redo', label: 'Redo', group: 'Edit', scope: 'global', keys: ['Mod+Shift+Z', 'Mod+Y'] },
  // ── View ──
  { id: 'view.editor', label: 'Editor tab', group: 'View', scope: 'global', keys: ['Alt+E'] },
  { id: 'view.mixer', label: 'Mixer tab', group: 'View', scope: 'global', keys: ['Alt+X'] },
  { id: 'view.instruments', label: 'Instruments tab', group: 'View', scope: 'global', keys: ['Alt+I'] },
  { id: 'view.fx', label: 'Effects tab', group: 'View', scope: 'global', keys: ['Alt+F'] },
  { id: 'view.settings', label: 'Settings', group: 'View', scope: 'global', keys: ['Mod+,'] },
  // ── Help ──
  { id: 'help.shortcuts', label: 'Keyboard shortcuts', group: 'Help', scope: 'global', keys: ['?'] },
  { id: 'help.guide', label: 'User guide (opens at the current panel)', group: 'Help', scope: 'global', keys: ['F1'] },
  { id: 'help.welcome', label: 'Welcome screen', group: 'Help', scope: 'global', keys: [] },
  // ── Arrangement (after clicking in it) ──
  { id: 'arrange.delete', label: 'Delete selected clips', group: 'Arrangement', scope: 'arrange', keys: ['Delete', 'Backspace'] },
  { id: 'arrange.duplicate', label: 'Duplicate selected clips', group: 'Arrangement', scope: 'arrange', keys: ['Mod+D'], always: true },
  { id: 'arrange.split', label: 'Split clip at the playhead', group: 'Arrangement', scope: 'arrange', keys: ['Mod+E'], always: true },
  { id: 'arrange.selectAll', label: 'Select every clip', group: 'Arrangement', scope: 'arrange', keys: ['Mod+A'] },
  { id: 'arrange.copy', label: 'Copy selected clips', group: 'Arrangement', scope: 'arrange', keys: ['Mod+C'] },
  { id: 'arrange.paste', label: 'Paste clips at the playhead', group: 'Arrangement', scope: 'arrange', keys: ['Mod+V'] },
  { id: 'arrange.mute', label: 'Mute selected track', group: 'Arrangement', scope: 'arrange', keys: ['M'] },
  { id: 'arrange.solo', label: 'Solo selected track', group: 'Arrangement', scope: 'arrange', keys: ['S'] },
  { id: 'arrange.prevTrack', label: 'Select track above', group: 'Arrangement', scope: 'arrange', keys: ['ArrowUp'] },
  { id: 'arrange.nextTrack', label: 'Select track below', group: 'Arrangement', scope: 'arrange', keys: ['ArrowDown'] },
  { id: 'arrange.deselect', label: 'Deselect', group: 'Arrangement', scope: 'arrange', keys: ['Escape'] },
  // ── Editor (after clicking in it) ──
  { id: 'editor.draw', label: 'Draw mode', group: 'Editor', scope: 'editor', keys: ['B'] },
  { id: 'editor.select', label: 'Select mode', group: 'Editor', scope: 'editor', keys: ['V'] },
  { id: 'editor.selectAll', label: 'Select every note', group: 'Editor', scope: 'editor', keys: ['Mod+A'] },
  { id: 'editor.copy', label: 'Copy notes', group: 'Editor', scope: 'editor', keys: ['Mod+C'] },
  { id: 'editor.paste', label: 'Paste notes', group: 'Editor', scope: 'editor', keys: ['Mod+V'] },
  { id: 'editor.delete', label: 'Delete selected notes', group: 'Editor', scope: 'editor', keys: ['Delete', 'Backspace'] },
  { id: 'editor.quantize', label: 'Quantize selected notes', group: 'Editor', scope: 'editor', keys: ['Q'] },
  { id: 'editor.up', label: 'Transpose up a semitone', group: 'Editor', scope: 'editor', keys: ['ArrowUp'] },
  { id: 'editor.down', label: 'Transpose down a semitone', group: 'Editor', scope: 'editor', keys: ['ArrowDown'] },
  { id: 'editor.octaveUp', label: 'Transpose up an octave', group: 'Editor', scope: 'editor', keys: ['Shift+ArrowUp'] },
  { id: 'editor.octaveDown', label: 'Transpose down an octave', group: 'Editor', scope: 'editor', keys: ['Shift+ArrowDown'] },
  { id: 'editor.deselect', label: 'Deselect notes', group: 'Editor', scope: 'editor', keys: ['Escape'] },
  { id: 'editor.piano', label: 'Play notes from the computer keyboard', group: 'Editor', scope: 'editor', keys: ['A … ;'], docOnly: true },
];

const BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));

// ─── Labels ───────────────────────────────────────────────────────────────────

export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const p = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
    ?? navigator.platform ?? '';
  return /mac|iphone|ipad/i.test(p) || /Mac OS X/.test(navigator.userAgent);
}

const NAMES: Record<string, string> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Delete: 'Del', Backspace: '⌫', Escape: 'Esc', Space: 'Space',
};

/** "Mod+Shift+Z" → "⇧⌘Z" on a Mac, "Ctrl+Shift+Z" elsewhere. */
export function formatKeys(spec: string, mac = isMac()): string {
  const parts = spec.split('+');
  const key = parts.pop()!;
  const mods = new Set(parts);
  const name = NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  if (mac) {
    return `${mods.has('Alt') ? '⌥' : ''}${mods.has('Shift') ? '⇧' : ''}${mods.has('Mod') ? '⌘' : ''}${name}`;
  }
  return [...(mods.has('Mod') ? ['Ctrl'] : []), ...(mods.has('Alt') ? ['Alt'] : []), ...(mods.has('Shift') ? ['Shift'] : []), name].join('+');
}

/** The primary keys of a shortcut, formatted for this platform ("" if unknown). */
export function shortcutLabel(id: string): string {
  const s = BY_ID.get(id);
  return s?.keys.length ? formatKeys(s.keys[0]) : '';
}

/** "Undo (⌘Z)" — a tooltip with its shortcut. */
export function withShortcut(text: string, id: string): string {
  const k = shortcutLabel(id);
  return k ? `${text} (${k})` : text;
}

// ─── Matching ─────────────────────────────────────────────────────────────────

/** Does a key event match one key spec? Exported for tests. */
export function matches(spec: string, e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): boolean {
  const parts = spec.split('+');
  const key = parts.pop()!;
  const mods = new Set(parts);
  const mod = e.ctrlKey || e.metaKey;
  if (mods.has('Mod') !== mod) return false;
  if (mods.has('Alt') !== e.altKey) return false;
  if (key === '?') return e.key === '?';            // Shift is part of typing "?" on most layouts
  // Shift must match exactly: "ArrowUp" and "Shift+ArrowUp" are different shortcuts
  if (mods.has('Shift') !== e.shiftKey) return false;
  if (key === 'Space') return e.code === 'Space';
  if (key.length === 1 && /[A-Z0-9]/i.test(key)) {
    if (e.altKey) return e.code === (/[0-9]/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`);
    return e.key.toLowerCase() === key.toLowerCase();
  }
  return e.key === key;
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/** A handler returns false when it doesn't apply, so the key falls through. */
type Handler = (e: KeyboardEvent) => boolean | void;
const handlers = new Map<string, Handler[]>();

/**
 * Attach behaviour to shortcuts while the calling component is mounted.
 * Handlers see the latest props through a ref, so the map can be inline.
 */
export function useShortcuts(map: Record<string, Handler>): void {
  const latest = useRef(map);
  latest.current = map;
  const ids = Object.keys(map).join('|');
  useEffect(() => {
    const own: [string, Handler][] = ids.split('|').filter(Boolean).map((id) => {
      if (!BY_ID.has(id)) console.warn(`Unknown shortcut id: ${id}`);
      const h: Handler = (e) => latest.current[id]?.(e);
      return [id, h];
    });
    for (const [id, h] of own) handlers.set(id, [...(handlers.get(id) ?? []), h]);
    return () => {
      for (const [id, h] of own) handlers.set(id, (handlers.get(id) ?? []).filter((x) => x !== h));
    };
  }, [ids]);
}

/** Ids with no handler mounted right now — the e2e checks this is empty. */
export function missingHandlers(): string[] {
  return SHORTCUTS.filter((s) => !s.docOnly && !(handlers.get(s.id)?.length)).map((s) => s.id);
}

function inScope(scope: ShortcutScope): boolean {
  if (scope === 'global') return true;
  const zone = getFocusZone();
  return scope === 'editor' ? zone === 'editor' : zone !== 'editor';
}

/** Run a command by id — the desktop app's menu bar uses this. */
export function runShortcut(id: string): boolean {
  const e = new KeyboardEvent('keydown');
  for (const h of handlers.get(id) ?? []) if (h(e) !== false) return true;
  return false;
}

/** Keys a focused slider uses itself: they move the slider, not the song. */
const SLIDER_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);
function sliderKey(e: KeyboardEvent): boolean {
  const t = e.target;
  return t instanceof HTMLInputElement && t.type === 'range' && SLIDER_KEYS.has(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey;
}

/** The one keydown listener. Install once (AppShell). */
export function dispatchShortcut(e: KeyboardEvent): void {
  if (e.defaultPrevented || isTypingTarget(e.target) || isOverlayOpen() || sliderKey(e)) return;
  // Most specific first: "Shift+ArrowUp" before "ArrowUp" is handled by matching Shift exactly
  for (const s of SHORTCUTS) {
    if (s.docOnly || !s.keys.some((k) => matches(k, e))) continue;
    if (s.always) e.preventDefault();
    if (!inScope(s.scope)) continue;
    for (const h of handlers.get(s.id) ?? []) {
      if (h(e) !== false) { e.preventDefault(); return; }
    }
  }
}

if (typeof window !== 'undefined') {
  // Exposed for the end-to-end tests
  (window as unknown as { __oscShortcuts?: unknown }).__oscShortcuts = { missingHandlers };
}
