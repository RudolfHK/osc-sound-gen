import { useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { dismiss, notify } from './notices';

/** Only the latest undo/redo notice stays up — pressing ⌘Z five times shows one. */
let lastNotice: number | null = null;
function announce(text: string, action: { label: string; run: () => void }) {
  if (lastNotice !== null) dismiss(lastNotice);
  lastNotice = notify(text, 'info', action);
}

/**
 * Undo and redo with names: what the next undo/redo will do, and a short
 * notice after each that offers the opposite.
 */
export function useHistory() {
  const { state, dispatch } = useAppStore();
  const { undoStack, redoStack } = state.sequencer;
  const undoName = undoStack.length ? (undoStack[undoStack.length - 1].label ?? 'last edit') : null;
  const redoName = redoStack.length ? (redoStack[0].label ?? 'last edit') : null;

  /** Undo `steps` edits. False when there's nothing to undo. */
  const undo = useCallback((steps = 1): boolean => {
    if (!undoStack.length) return false;
    const n = Math.min(steps, undoStack.length);
    const name = undoStack[undoStack.length - n].label ?? 'last edit';
    dispatch({ type: 'SEQ_UNDO', steps: n });
    announce(n === 1 ? `Undone: ${name}` : `Undone ${n} steps, back to before “${name}”`, {
      label: 'Redo', run: () => dispatch({ type: 'SEQ_REDO', steps: n }),
    });
    return true;
  }, [undoStack, dispatch]);

  const redo = useCallback((steps = 1): boolean => {
    if (!redoStack.length) return false;
    const n = Math.min(steps, redoStack.length);
    const name = redoStack[n - 1].label ?? 'last edit';
    dispatch({ type: 'SEQ_REDO', steps: n });
    announce(n === 1 ? `Redone: ${name}` : `Redone ${n} steps, up to “${name}”`, {
      label: 'Undo', run: () => dispatch({ type: 'SEQ_UNDO', steps: n }),
    });
    return true;
  }, [redoStack, dispatch]);

  return { undo, redo, undoName, redoName, undoStack, redoStack };
}
