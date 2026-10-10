import { useCallback } from 'react';
import { findClip, selectedClips, useAppStore, type ClipCopy } from '../store/appStore';
import { getPlayhead } from '../engine/playhead';
import { notify } from '../ui/notices';
import { arrangeGrid } from './geometry';

/**
 * Copied clips. Kept outside the song (and the undo history), like any
 * clipboard; note clips carry their notes so a paste is unaffected by edits
 * to the original afterwards.
 */
let clipboard: ClipCopy[] = [];

export function hasClipboard(): boolean {
  return clipboard.length > 0;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What the arrangement's keys and menus do to the selected clips. */
export function useClipActions() {
  const { state, dispatch } = useAppStore();
  const seq = state.sequencer;
  const selection = selectedClips(seq);

  const deleteSelected = useCallback((): boolean => {
    if (!selection.length) return false;
    dispatch({ type: 'SEQ_PUSH_UNDO' });
    dispatch({ type: 'CLIPS_DELETE', clipIds: selection });
    return true;
  }, [selection, dispatch]);

  const duplicateSelected = useCallback((): boolean => {
    if (!selection.length) return false;
    dispatch({ type: 'SEQ_PUSH_UNDO' });
    dispatch({ type: 'CLIPS_DUPLICATE', clipIds: selection });
    return true;
  }, [selection, dispatch]);

  const copySelected = useCallback((): boolean => {
    const items: ClipCopy[] = [];
    for (const id of selection) {
      const found = findClip(seq, id);
      if (!found) continue;
      const isDrums = found.track.source.type === 'drums';
      items.push({ trackId: found.track.id, isDrums, clip: found.clip, pattern: isDrums ? undefined : seq.patterns[found.clip.patternId] });
    }
    if (!items.length) return false;
    clipboard = items;
    notify(`Copied ${plural(items.length, 'clip')}. Paste puts them at the playhead.`);
    return true;
  }, [selection, seq]);

  /** Paste at the playhead (on the grid), onto the selected track when the copy came from one track. */
  const paste = useCallback((atBeat?: number): boolean => {
    if (!clipboard.length) return false;
    const g = arrangeGrid(seq);
    const at = atBeat ?? Math.floor((seq.isPlaying ? getPlayhead() : seq.playheadBeat) / g + 1e-6) * g;
    dispatch({ type: 'SEQ_PUSH_UNDO' });
    dispatch({ type: 'CLIPS_PASTE', items: clipboard, atBeat: Math.max(0, at), trackId: seq.selectedTrackId });
    return true;
  }, [seq, dispatch]);

  const selectAll = useCallback((): boolean => {
    const ids = seq.tracks.flatMap((t) => t.clips.map((c) => c.id));
    if (!ids.length) return false;
    dispatch({ type: 'CLIPS_SELECT', clipIds: ids });
    return true;
  }, [seq.tracks, dispatch]);

  /** Split every selected clip the playhead is inside (or the focused clip at the playhead). */
  const splitAtPlayhead = useCallback((): boolean => {
    const at = seq.isPlaying ? getPlayhead() : seq.playheadBeat;
    const inside = selection
      .map((id) => findClip(seq, id))
      .filter((f) => f && f.clip.startBeat < at - 1e-6 && at < f.clip.startBeat + f.clip.lengthBeats - 1e-6);
    if (!inside.length) return false;
    dispatch({ type: 'SEQ_PUSH_UNDO' });
    for (const f of inside) dispatch({ type: 'CLIP_SPLIT', clipId: f!.clip.id, atBeat: at });
    return true;
  }, [selection, seq, dispatch]);

  return { selection, deleteSelected, duplicateSelected, copySelected, paste, selectAll, splitAtPlayhead };
}
