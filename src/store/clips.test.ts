import { describe, it, expect } from 'vitest';
import { reducer, makeInitialAppState, selectedClips, findClip } from './appStore';
import type { AppState } from '../engine/oscillator';

/** Starter session with two 4-beat clips on Keys (bars 1 and 3) and one on Bass. */
function withClips(): { s: AppState; keys: string; bass: string; drums: string } {
  let s = makeInitialAppState();
  const byName = (n: string) => s.sequencer.tracks.find((t) => t.name === n)!.id;
  const keys = byName('Keys'), bass = byName('Bass'), drums = byName('Drums');
  s = reducer(s, { type: 'CLIP_ADD', trackId: keys, startBeat: 0, lengthBeats: 4 });
  s = reducer(s, { type: 'CLIP_ADD', trackId: keys, startBeat: 8, lengthBeats: 4 });
  s = reducer(s, { type: 'CLIP_ADD', trackId: bass, startBeat: 4, lengthBeats: 4 });
  return { s, keys, bass, drums };
}
const clipsOf = (s: AppState, trackId: string) => s.sequencer.tracks.find((t) => t.id === trackId)!.clips;

describe('multi-clip selection', () => {
  it('Shift-click adds and removes clips; a plain click selects one', () => {
    const { s: s0, keys, bass } = withClips();
    const [a, b] = clipsOf(s0, keys).map((c) => c.id);
    const c = clipsOf(s0, bass)[0].id;
    let s = reducer(s0, { type: 'CLIP_SELECT', clipId: a });
    s = reducer(s, { type: 'CLIP_SELECT', clipId: c, toggle: true });
    s = reducer(s, { type: 'CLIP_SELECT', clipId: b, toggle: true });
    expect(selectedClips(s.sequencer).sort()).toEqual([a, b, c].sort());
    s = reducer(s, { type: 'CLIP_SELECT', clipId: c, toggle: true });
    expect(selectedClips(s.sequencer).sort()).toEqual([a, b].sort());
    s = reducer(s, { type: 'CLIP_SELECT', clipId: c });
    expect(selectedClips(s.sequencer)).toEqual([c]);
  });

  it('selecting one clip any other way ends a multi-selection', () => {
    const { s: s0, keys } = withClips();
    const ids = clipsOf(s0, keys).map((c) => c.id);
    let s = reducer(s0, { type: 'CLIPS_SELECT', clipIds: ids });
    expect(selectedClips(s.sequencer)).toHaveLength(2);
    s = reducer(s, { type: 'CLIP_ADD', trackId: keys, startBeat: 20, lengthBeats: 4 });
    expect(selectedClips(s.sequencer)).toHaveLength(1);
  });
});

describe('group edits', () => {
  it('duplicates a selection after itself, with copies of the notes', () => {
    const { s: s0, keys, bass } = withClips();
    const ids = [...clipsOf(s0, keys).map((c) => c.id), clipsOf(s0, bass)[0].id];
    const s = reducer(s0, { type: 'CLIPS_DUPLICATE', clipIds: ids });
    // The selection spans beats 0–12, so copies start 12 beats later
    expect(clipsOf(s, keys).map((c) => c.startBeat).sort((x, y) => x - y)).toEqual([0, 8, 12, 20]);
    expect(clipsOf(s, bass).map((c) => c.startBeat).sort((x, y) => x - y)).toEqual([4, 16]);
    const copies = selectedClips(s.sequencer).map((id) => findClip(s.sequencer, id)!.clip);
    expect(copies).toHaveLength(3);
    for (const c of copies) expect(ids.map((id) => findClip(s.sequencer, id)!.clip.patternId)).not.toContain(c.patternId);
  });

  it('moves a group by the same amount and stops it at the song start', () => {
    const { s: s0, keys } = withClips();
    const ids = clipsOf(s0, keys).map((c) => c.id);
    let s = reducer(s0, { type: 'CLIPS_MOVE', clipIds: ids, deltaBeats: 4 });
    expect(clipsOf(s, keys).map((c) => c.startBeat)).toEqual([4, 12]);
    s = reducer(s, { type: 'CLIPS_MOVE', clipIds: ids, deltaBeats: -100 });
    expect(clipsOf(s, keys).map((c) => c.startBeat)).toEqual([0, 8]);
  });

  it('pastes clips copied from one track onto another of the same kind', () => {
    const { s: s0, keys, bass, drums } = withClips();
    const items = clipsOf(s0, keys).map((clip) => ({
      trackId: keys, isDrums: false, clip, pattern: s0.sequencer.patterns[clip.patternId],
    }));
    let s = reducer(s0, { type: 'CLIPS_PASTE', items, atBeat: 16, trackId: bass });
    expect(clipsOf(s, bass).map((c) => c.startBeat).sort((x, y) => x - y)).toEqual([4, 16, 24]);
    // A drum track can't take note clips: they go back to their own track
    s = reducer(s0, { type: 'CLIPS_PASTE', items, atBeat: 16, trackId: drums });
    expect(clipsOf(s, drums)).toHaveLength(0);
    expect(clipsOf(s, keys)).toHaveLength(4);
  });

  it('deletes a selection at once', () => {
    const { s: s0, keys, bass } = withClips();
    const ids = clipsOf(s0, keys).map((c) => c.id);
    const s = reducer(s0, { type: 'CLIPS_DELETE', clipIds: ids });
    expect(clipsOf(s, keys)).toHaveLength(0);
    expect(clipsOf(s, bass)).toHaveLength(1);
  });

  it('colours clips and puts the track colour back', () => {
    const { s: s0, keys } = withClips();
    const id = clipsOf(s0, keys)[0].id;
    let s = reducer(s0, { type: 'CLIP_SET_COLOR', clipIds: [id], color: '#ff0000' });
    expect(clipsOf(s, keys)[0].color).toBe('#ff0000');
    s = reducer(s, { type: 'CLIP_SET_COLOR', clipIds: [id], color: null });
    expect('color' in clipsOf(s, keys)[0]).toBe(false);
  });
});
