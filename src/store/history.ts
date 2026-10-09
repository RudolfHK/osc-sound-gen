/**
 * One undo history across stores.
 *
 * The song lives in more than one store: tracks, clips and patterns in the app
 * store, drum patterns in the drum store, the master effects in the effects
 * store. Undo has to treat them as one document — undoing "delete drum pattern"
 * must bring back both the pattern and the clips that used it.
 *
 * The app store owns the history stack. Other stores take part by registering
 * a participant: a snapshot of their undoable state (taken whenever an undo
 * step is recorded) and a way to restore one. Before an edit, a store asks for
 * an undo step with `requestUndoStep`; the app store records the document plus
 * every participant's snapshot.
 */

export interface HistoryParticipant<T = unknown> {
  /** Key in the undo entry. */
  id: string;
  /** Current undoable state. Must return the same object while nothing changed. */
  snapshot(): T;
  /** Put a recorded state back. */
  restore(value: T): void;
}

const participants = new Map<string, HistoryParticipant>();

export function registerHistoryParticipant<T>(p: HistoryParticipant<T>): () => void {
  participants.set(p.id, p as HistoryParticipant);
  return () => { if (participants.get(p.id) === p) participants.delete(p.id); };
}

/** Every participant's current snapshot, keyed by id. */
export function snapshotParticipants(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, p] of participants) out[id] = p.snapshot();
  return out;
}

export function restoreParticipants(extras: Record<string, unknown>): void {
  for (const [id, value] of Object.entries(extras)) {
    if (value !== undefined) participants.get(id)?.restore(value);
  }
}

/**
 * Record an undo step before an edit. `key` merges a run of edits to the same
 * control into one step (a fader drag); `null` always makes a new step.
 */
let requester: ((key: string | null) => void) | null = null;

export function setUndoStepRequester(fn: ((key: string | null) => void) | null): void {
  requester = fn;
}

export function requestUndoStep(key: string | null): void {
  requester?.(key);
}
