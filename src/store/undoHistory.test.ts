import { describe, it, expect } from 'vitest';
import { reducer, makeInitialAppState, autoUndoKey, undoLabel, type Action } from './appStore';
import type { AppState } from '../engine/oscillator';

const fresh = (): AppState => makeInitialAppState();

/** One of each action that edits the song, as the UI dispatches them. */
function sampleEdits(s: AppState): Action[] {
  const track = s.sequencer.tracks[1];
  const clip = { id: 'c1' };
  return [
    { type: 'TRACK_UPDATE', trackId: track.id, patch: { muted: true } },
    { type: 'TRACK_UPDATE', trackId: track.id, patch: { name: 'Lead' } },
    { type: 'SEQ_SET_CHANNEL', trackId: track.id, channel: { gain: 0.4 } },
    { type: 'SEQ_SET_ARP', trackId: track.id, arp: { enabled: true } },
    { type: 'TRACK_SET_PATCH', trackId: track.id, patch: { cutoff: 900 } },
    { type: 'TRACK_SET_PATCH', trackId: track.id, patch: null },
    { type: 'SEQ_SET_BPM', bpm: 99 },
    { type: 'SEQ_SET_SONG_LENGTH', bars: 12 },
    { type: 'SEQ_SET_LOOP', enabled: true },
    { type: 'SEQ_SET_BEATS_PER_BAR', bpb: 3 },
    { type: 'PATTERN_RENAME', patternId: 'p', name: 'x' },
    { type: 'TRACK_ADD', source: { type: 'drums' } },
    { type: 'TRACK_REMOVE', trackId: track.id },
    { type: 'TRACK_DUPLICATE', trackId: track.id },
    { type: 'TRACK_MOVE', trackId: track.id, toIndex: 0 },
    { type: 'TRACK_SET_SOURCE', trackId: track.id, source: { type: 'drums' } },
    { type: 'MARKER_ADD', beat: 4 },
    { type: 'MARKER_UPDATE', id: 'm', patch: { name: 'Drop' } },
    { type: 'MARKER_REMOVE', id: 'm' },
    { type: 'SECTION_DUPLICATE', markerId: 'm' },
    { type: 'SECTION_DELETE', markerId: 'm' },
    { type: 'CLIP_TOGGLE_MUTE', clipId: clip.id },
    { type: 'SEQ_ADD_LANE', trackId: track.id, target: { kind: 'channel', param: 'gain' } as never },
    { type: 'SEQ_REMOVE_LANE', trackId: track.id, laneId: 'l' },
    { type: 'SEQ_TOGGLE_LANE', trackId: track.id, laneId: 'l' },
    { type: 'SEQ_CLEAR_LANE', trackId: track.id, laneId: 'l' },
    // Edits whose undo step the component records just before dispatching them
    { type: 'CLIP_ADD', trackId: track.id, startBeat: 0, lengthBeats: 4 },
    { type: 'CLIP_MOVE', clipId: clip.id, trackId: track.id, startBeat: 4 },
    { type: 'CLIP_RESIZE', clipId: clip.id, startBeat: 0, lengthBeats: 2, offsetBeats: 0 },
    { type: 'CLIP_DELETE', clipId: clip.id },
    { type: 'CLIP_DUPLICATE', clipId: clip.id },
    { type: 'CLIP_SPLIT', clipId: clip.id, atBeat: 2 },
    { type: 'SEQ_ADD_NOTE', patternId: 'p', note: { id: 'n', midiNote: 60, startBeat: 0, durationBeats: 1, velocity: 100 } },
    { type: 'SEQ_MOVE_NOTE', patternId: 'p', noteId: 'n', startBeat: 1, midiNote: 61 },
    { type: 'SEQ_DELETE_SELECTED', patternId: 'p' },
    { type: 'SEQ_PASTE', patternId: 'p', atBeat: 0 },
    { type: 'SEQ_QUANTIZE', patternId: 'p' },
    { type: 'SEQ_ADD_POINT', trackId: track.id, laneId: 'l', beat: 0, value: 1 },
  ];
}

describe('named undo', () => {
  it('every song edit has a name', () => {
    const s = fresh();
    for (const a of sampleEdits(s)) {
      expect(undoLabel(a, s), a.type).toBeTruthy();
    }
    // Everything that records its own step automatically is named too
    for (const a of sampleEdits(s)) {
      if (autoUndoKey(a) !== undefined) expect(undoLabel(a, s), a.type).toBeTruthy();
    }
  });

  it('names mixer edits after the track', () => {
    const s = fresh();
    const bass = s.sequencer.tracks.find((t) => t.name === 'Bass')!;
    expect(undoLabel({ type: 'SEQ_SET_CHANNEL', trackId: bass.id, channel: { gain: 0.5 } }, s)).toBe('Fader: Bass');
    expect(undoLabel({ type: 'TRACK_UPDATE', trackId: bass.id, patch: { solo: true } }, s)).toBe('Solo: Bass');
  });

  it('view changes are not edits', () => {
    const s = fresh();
    const id = s.sequencer.tracks[0].id;
    expect(undoLabel({ type: 'TRACK_UPDATE', trackId: id, patch: { showAutomation: true } }, s)).toBeUndefined();
    expect(undoLabel({ type: 'CLIP_SELECT', clipId: null }, s)).toBeUndefined();
    expect(undoLabel({ type: 'SEQ_SET_PLAYHEAD', beat: 3 }, s)).toBeUndefined();
  });

  it('a label given later names the newest unnamed step only', () => {
    let s = reducer(fresh(), { type: 'SEQ_PUSH_UNDO' });
    s = reducer(s, { type: 'SEQ_LABEL_UNDO', label: 'Move clip' });
    s = reducer(s, { type: 'SEQ_LABEL_UNDO', label: 'Something else' });
    expect(s.sequencer.undoStack.at(-1)!.label).toBe('Move clip');
  });

  it('carries the name across undo and redo', () => {
    let s = fresh();
    s = reducer(s, { type: 'SEQ_PUSH_UNDO', label: 'Tempo' });
    s = reducer(s, { type: 'SEQ_SET_BPM', bpm: 140 });
    s = reducer(s, { type: 'SEQ_UNDO' });
    expect(s.sequencer.redoStack[0].label).toBe('Tempo');
    s = reducer(s, { type: 'SEQ_REDO' });
    expect(s.sequencer.undoStack.at(-1)!.label).toBe('Tempo');
    expect(s.sequencer.bpm).toBe(140);
  });
});

describe('History jumps', () => {
  /** Three named tempo edits: 100 → 110 → 120 → 130. */
  function threeEdits(): AppState {
    let s = reducer(fresh(), { type: 'SEQ_SET_BPM', bpm: 100 });
    for (const bpm of [110, 120, 130]) {
      s = reducer(s, { type: 'SEQ_PUSH_UNDO', label: `to ${bpm}` });
      s = reducer(s, { type: 'SEQ_SET_BPM', bpm });
    }
    return s;
  }

  it('jumping back n steps equals undoing n times', () => {
    const jumped = reducer(threeEdits(), { type: 'SEQ_UNDO', steps: 2 });
    let stepped = threeEdits();
    stepped = reducer(stepped, { type: 'SEQ_UNDO' });
    stepped = reducer(stepped, { type: 'SEQ_UNDO' });
    expect(jumped.sequencer.bpm).toBe(110);
    expect(stepped.sequencer.bpm).toBe(110);
    const view = (x: AppState) => ({
      undo: x.sequencer.undoStack.map((e) => [e.label, e.song.bpm]),
      redo: x.sequencer.redoStack.map((e) => [e.label, e.song.bpm]),
    });
    expect(view(jumped)).toEqual(view(stepped));
  });

  it('jumping forward n steps equals redoing n times', () => {
    const back = reducer(threeEdits(), { type: 'SEQ_UNDO', steps: 3 });
    expect(back.sequencer.bpm).toBe(100);
    const jumped = reducer(back, { type: 'SEQ_REDO', steps: 2 });
    let stepped = reducer(back, { type: 'SEQ_REDO' });
    stepped = reducer(stepped, { type: 'SEQ_REDO' });
    expect(jumped.sequencer.bpm).toBe(120);
    expect(stepped.sequencer.bpm).toBe(120);
    const view = (x: AppState) => ({
      undo: x.sequencer.undoStack.map((e) => [e.label, e.song.bpm]),
      redo: x.sequencer.redoStack.map((e) => [e.label, e.song.bpm]),
    });
    expect(view(jumped)).toEqual(view(stepped));
  });

  it('clamps a jump to the history there is', () => {
    const s = reducer(threeEdits(), { type: 'SEQ_UNDO', steps: 99 });
    expect(s.sequencer.bpm).toBe(100);
    expect(s.sequencer.undoStack).toHaveLength(0);
    expect(s.sequencer.redoStack).toHaveLength(3);
  });
});
