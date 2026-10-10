import { describe, it, expect } from 'vitest';
import { SHORTCUTS, formatKeys, matches } from './shortcuts';

const key = (k: Partial<KeyboardEvent>) => ({
  key: '', code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...k,
}) as KeyboardEvent;

describe('shortcut registry', () => {
  it('has unique ids and no clashing keys within a scope', () => {
    const ids = new Set<string>();
    const seen = new Map<string, string>();
    for (const s of SHORTCUTS) {
      expect(ids.has(s.id), s.id).toBe(false);
      ids.add(s.id);
      for (const k of s.keys) {
        // Global keys clash with everything; scoped keys only within their scope
        for (const scope of s.scope === 'global' ? ['arrange', 'editor'] : [s.scope]) {
          const slot = `${scope}:${k}`;
          expect(seen.get(slot), `${k} is used by ${seen.get(slot)} and ${s.id}`).toBeUndefined();
          seen.set(slot, s.id);
        }
      }
    }
  });

  it('labels keys the Mac way on a Mac', () => {
    expect(formatKeys('Mod+Shift+Z', true)).toBe('⇧⌘Z');
    expect(formatKeys('Mod+Shift+Z', false)).toBe('Ctrl+Shift+Z');
    expect(formatKeys('Alt+X', true)).toBe('⌥X');
    expect(formatKeys('ArrowUp', false)).toBe('↑');
  });

  it('matches Mod to Ctrl or ⌘', () => {
    expect(matches('Mod+S', key({ key: 's', ctrlKey: true }))).toBe(true);
    expect(matches('Mod+S', key({ key: 's', metaKey: true }))).toBe(true);
    expect(matches('Mod+S', key({ key: 's' }))).toBe(false);
    expect(matches('Mod+S', key({ key: 'S', ctrlKey: true, shiftKey: true }))).toBe(false);
  });

  it('reads the physical key with Alt, so macOS Option works', () => {
    // Option+X types "≈" on a Mac keyboard
    expect(matches('Alt+X', key({ key: '≈', code: 'KeyX', altKey: true }))).toBe(true);
    expect(matches('Alt+X', key({ key: 'x', code: 'KeyX' }))).toBe(false);
  });

  it('keeps plain and shifted arrows apart', () => {
    expect(matches('ArrowUp', key({ key: 'ArrowUp' }))).toBe(true);
    expect(matches('ArrowUp', key({ key: 'ArrowUp', shiftKey: true }))).toBe(false);
    expect(matches('Shift+ArrowUp', key({ key: 'ArrowUp', shiftKey: true }))).toBe(true);
  });

  it('matches "?" however the layout produces it', () => {
    expect(matches('?', key({ key: '?', shiftKey: true }))).toBe(true);
    expect(matches('?', key({ key: '/', shiftKey: true }))).toBe(false);
  });
});
