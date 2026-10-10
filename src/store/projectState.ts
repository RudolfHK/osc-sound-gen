/**
 * Has the song changed since it was last saved, and where does Save write?
 *
 * The document is spread over several stores, all immutable, so "changed" is
 * cheap to answer: keep the references that made up the song when it was last
 * saved (its signature) and compare them with the current ones. Undoing back
 * to the saved state restores the same objects, so the project reads as
 * saved again — no deep comparison needed.
 *
 * The flag survives a reload: the session itself is restored from browser
 * storage, but unsaved work restored that way is still unsaved.
 */
import { useSyncExternalStore } from 'react';

const KEY = 'osc-unsaved';

export type DocumentSignature = readonly unknown[];

export interface ProjectStatus {
  /** Unsaved changes since the last save, open or new project. */
  dirty: boolean;
  /** The file Save writes to, if one is known (opened or saved this session). */
  fileName: string | null;
  /** A write to the file is in progress. */
  saving: boolean;
}

let baseline: DocumentSignature | null = null;
let current: DocumentSignature | null = null;
let carried = readCarried();
let status: ProjectStatus = { dirty: carried, fileName: null, saving: false };
const listeners = new Set<() => void>();

function readCarried(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

function same(a: DocumentSignature, b: DocumentSignature): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

function publish(patch: Partial<ProjectStatus>): void {
  const next = { ...status, ...patch };
  if (next.dirty === status.dirty && next.fileName === status.fileName && next.saving === status.saving) return;
  if (next.dirty !== status.dirty) {
    try {
      if (next.dirty) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY);
    } catch { /* storage unavailable */ }
  }
  status = next;
  for (const l of listeners) l();
}

function recompute(): void {
  publish({ dirty: carried || (!!baseline && !!current && !same(baseline, current)) });
}

/** Report the current document. The first one seen after a load is the saved state. */
export function trackDocument(sig: DocumentSignature): void {
  current = sig;
  if (!baseline) baseline = sig;
  recompute();
}

/** The current document was just written to `fileName`. */
export function markSaved(fileName: string): void {
  baseline = current;
  carried = false;
  publish({ dirty: false, fileName });
}

/**
 * A different project replaced the current one (open, example, new). The next
 * document reported becomes the saved state.
 */
export function markReplaced(fileName: string | null): void {
  baseline = null;
  carried = false;
  publish({ dirty: false, fileName });
}

export function setSaving(saving: boolean): void {
  publish({ saving });
}

export function getProjectStatus(): ProjectStatus {
  return status;
}

export function useProjectStatus(): ProjectStatus {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => status,
    () => status,
  );
}

// ─── Crash recovery ──────────────────────────────────────────────────────────

/**
 * The latest way to turn the song into a project file. Kept outside React so
 * the crash screen can still offer "Save project" after the interface failed.
 */
let serializer: (() => { name: string; text: string }) | null = null;

export function setProjectSerializer(fn: typeof serializer): void {
  serializer = fn;
}

export function serializeCurrentProject(): { name: string; text: string } | null {
  try { return serializer?.() ?? null; } catch { return null; }
}
