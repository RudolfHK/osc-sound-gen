import { describe, it, expect } from 'vitest';
import { reducer, restoreState, makeInitialAppState, findClip, autoUndoKey, referencedPatterns } from './appStore';
import { DEFAULT_EFFECTS } from '../engine/effects';
import { parseProject, serializeProject, guessPresetForNotes, parseEffects } from '../utils/project';
import type { AppState } from '../engine/oscillator';

const fresh = (): AppState => makeInitialAppState();

/** A session saved by the release before v2: tracks bound to tabs, no arp/channel/lanes. */
function legacySession(): string {
  return JSON.stringify({
    tabs: [
      { id: 'tab-1', label: 'Lead', color: '#f00', oscillator: {}, advanced: { colorTheme: 'green' }, isPlaying: true, isMuted: false, solo: false },
      { id: 'tab-2', label: 'Bass', color: '#0f0', oscillator: {}, advanced: { colorTheme: 'green' }, isPlaying: false, isMuted: false, solo: false },
    ],
    activeTabId: 'tab-1',
    masterVolume: 0.7,
    sequencer: {
      bpm: 128, beatsPerBar: 4, songLengthBars: 4,
      tracks: [
        { tabId: 'tab-1', notes: [{ id: 'a', midiNote: 72, startBeat: 2.5, durationBeats: 0.5, velocity: 90 }], pan: 0.2 },
        { tabId: 'tab-2', notes: [{ id: 'b', midiNote: 36, startBeat: 0, durationBeats: 1, velocity: 100 }], pan: 0 },
      ],
    },
  });
}

describe('restoreState', () => {
  it('starts a new session with an instrument-based starter arrangement', () => {
    const s = restoreState(null, null);
    expect(s.sequencer.tracks.length).toBeGreaterThan(0);
    // No track depends on an oscillator tab by default
    expect(s.sequencer.tracks.every((t) => t.source.type !== 'oscillator')).toBe(true);
    expect(s.view).toBe('arrange');
  });

  it('migrates a pre-v2 session without crashing on missing fields', () => {
    const s = restoreState(legacySession(), JSON.stringify({ assignments: { 'tab-2': 'bass-sub' } }));
    const [lead, bass] = s.sequencer.tracks;

    // The crash in the previous release came from these being undefined
    expect(lead.arp).toBeDefined();
    expect(lead.channel).toBeDefined();
    expect(lead.lanes).toEqual([]);

    // Assigned instrument wins; otherwise the track keeps its oscillator
    expect(bass.source).toEqual({ type: 'preset', presetId: 'bass-sub' });
    expect(lead.source).toEqual({ type: 'oscillator', tabId: 'tab-1' });
    expect(lead.name).toBe('Lead');
    expect(lead.pan).toBe(0.2);

    // Notes keep their exact positions inside a clip that starts at bar 1
    expect(lead.clips).toHaveLength(1);
    expect(lead.clips[0].startBeat).toBe(0);
    const pat = s.sequencer.patterns[lead.clips[0].patternId];
    expect(pat.notes[0]).toMatchObject({ midiNote: 72, startBeat: 2.5 });

    // Runtime flags never survive a reload
    expect(s.tabs.every((t) => !t.isPlaying)).toBe(true);
    expect(s.sequencer.bpm).toBe(128);
  });

  it('drops note clips whose pattern is missing instead of crashing playback later', () => {
    const s = fresh();
    const withClip = reducer(s, { type: 'CLIP_ADD', trackId: s.sequencer.tracks[1].id, startBeat: 0, lengthBeats: 4 });
    const saved = JSON.parse(JSON.stringify(withClip));
    saved.sequencer.patterns = {};
    const restored = restoreState(JSON.stringify(saved), null);
    expect(restored.sequencer.tracks[1].clips).toHaveLength(0);
  });
});

describe('clips', () => {
  const setup = () => {
    let s = fresh();
    const trackId = s.sequencer.tracks[1].id; // Bass, a note track
    s = reducer(s, { type: 'CLIP_ADD', trackId, startBeat: 4, lengthBeats: 4 });
    const clipId = s.sequencer.selectedClipId!;
    return { s, trackId, clipId };
  };

  it('creates a pattern for a new note clip and selects it', () => {
    const { s, clipId } = setup();
    const found = findClip(s.sequencer, clipId)!;
    expect(s.sequencer.patterns[found.clip.patternId].lengthBeats).toBe(4);
  });

  it('duplicates independently by default and linked on request', () => {
    const { s, clipId } = setup();
    const indep = reducer(s, { type: 'CLIP_DUPLICATE', clipId });
    const linked = reducer(s, { type: 'CLIP_DUPLICATE', clipId, linked: true });
    const orig = findClip(s.sequencer, clipId)!.clip;
    const a = findClip(indep.sequencer, indep.sequencer.selectedClipId)!.clip;
    const b = findClip(linked.sequencer, linked.sequencer.selectedClipId)!.clip;
    expect(a.patternId).not.toBe(orig.patternId);
    expect(b.patternId).toBe(orig.patternId);
    expect(a.startBeat).toBe(8); // placed right after the original
  });

  it('splits a clip into two that together play the same material', () => {
    const { s, clipId } = setup();
    const next = reducer(s, { type: 'CLIP_SPLIT', clipId, atBeat: 5.5 });
    const clips = next.sequencer.tracks[1].clips.sort((x, y) => x.startBeat - y.startBeat);
    expect(clips).toHaveLength(2);
    expect(clips[0]).toMatchObject({ startBeat: 4, lengthBeats: 1.5, offsetBeats: 0 });
    expect(clips[1]).toMatchObject({ startBeat: 5.5, lengthBeats: 2.5, offsetBeats: 1.5 });
  });

  it('refuses to move a note clip onto a drum track', () => {
    const { s, clipId, trackId } = setup();
    const drumId = s.sequencer.tracks[0].id;
    const next = reducer(s, { type: 'CLIP_MOVE', clipId, trackId: drumId, startBeat: 0 });
    expect(findClip(next.sequencer, clipId)!.track.id).toBe(trackId);
  });

  it('grows the song to contain new clips', () => {
    const s = fresh();
    const next = reducer(s, { type: 'CLIP_ADD', trackId: s.sequencer.tracks[1].id, startBeat: 200, lengthBeats: 8 });
    expect(next.sequencer.songLengthBars * next.sequencer.beatsPerBar).toBeGreaterThanOrEqual(208);
  });

  it('extends a pattern when a note is drawn past its end', () => {
    const { s, clipId } = setup();
    const patternId = findClip(s.sequencer, clipId)!.clip.patternId;
    const next = reducer(s, {
      type: 'SEQ_ADD_NOTE', patternId,
      note: { id: 'n1', midiNote: 60, startBeat: 5, durationBeats: 1, velocity: 100 },
    });
    expect(next.sequencer.patterns[patternId].lengthBeats).toBe(8);
  });
});

describe('tracks', () => {
  it('clears clips when a track switches between drums and notes', () => {
    let s = fresh();
    const id = s.sequencer.tracks[1].id;
    s = reducer(s, { type: 'CLIP_ADD', trackId: id, startBeat: 0, lengthBeats: 4 });
    const keep = reducer(s, { type: 'TRACK_SET_SOURCE', trackId: id, source: { type: 'preset', presetId: 'lead-saw' } });
    const swap = reducer(s, { type: 'TRACK_SET_SOURCE', trackId: id, source: { type: 'drums' } });
    expect(keep.sequencer.tracks[1].clips).toHaveLength(1);
    expect(swap.sequencer.tracks[1].clips).toHaveLength(0);
  });

  it('falls back to a preset when an oscillator tab a track uses is removed', () => {
    let s = reducer(fresh(), { type: 'ADD_TAB' });
    const tabId = s.tabs[1].id;
    s = reducer(s, { type: 'TRACK_ADD', source: { type: 'oscillator', tabId } });
    s = reducer(s, { type: 'REMOVE_TAB', id: tabId });
    expect(s.sequencer.tracks[s.sequencer.tracks.length - 1].source.type).toBe('preset');
  });

  it('duplicates a track with its own copies of the patterns', () => {
    let s = fresh();
    const id = s.sequencer.tracks[1].id;
    s = reducer(s, { type: 'CLIP_ADD', trackId: id, startBeat: 0, lengthBeats: 4 });
    s = reducer(s, { type: 'TRACK_DUPLICATE', trackId: id });
    const [a, b] = [s.sequencer.tracks[1], s.sequencer.tracks[2]];
    expect(b.name).toBe(`${a.name} copy`);
    expect(b.clips[0].patternId).not.toBe(a.clips[0].patternId);
  });
});

describe('sections', () => {
  const build = () => {
    let s = fresh();
    const id = s.sequencer.tracks[1].id;
    s = reducer(s, { type: 'MARKER_ADD', beat: 16, name: 'Verse' });
    s = reducer(s, { type: 'CLIP_ADD', trackId: id, startBeat: 0, lengthBeats: 4 });   // in Intro
    s = reducer(s, { type: 'CLIP_ADD', trackId: id, startBeat: 16, lengthBeats: 4 });  // in Verse
    return { s, id, intro: s.sequencer.markers.find((m) => m.beat === 0)! };
  };

  it('duplicating a section copies its clips and pushes later material right', () => {
    const { s, id, intro } = build();
    const next = reducer(s, { type: 'SECTION_DUPLICATE', markerId: intro.id });
    const starts = next.sequencer.tracks.find((t) => t.id === id)!.clips.map((c) => c.startBeat).sort((a, b) => a - b);
    expect(starts).toEqual([0, 16, 32]); // copy of intro at 16, verse pushed to 32
    expect(next.sequencer.markers.map((m) => m.beat)).toEqual([0, 16, 32]);
  });

  it('deleting a section removes its clips and closes the gap', () => {
    const { s, id, intro } = build();
    const next = reducer(s, { type: 'SECTION_DELETE', markerId: intro.id });
    const starts = next.sequencer.tracks.find((t) => t.id === id)!.clips.map((c) => c.startBeat);
    expect(starts).toEqual([0]);
    expect(next.sequencer.markers).toHaveLength(1);
    expect(next.sequencer.markers[0]).toMatchObject({ name: 'Verse', beat: 0 });
  });
});

describe('chord track', () => {
  const C = { root: 0, quality: 'maj' as const };
  const Am = { root: 9, quality: 'min' as const };
  // Intro 0–16, Verse 16–32, Chorus from 32
  const withMarkers = () => reducer(
    reducer(fresh(), { type: 'MARKER_ADD', beat: 16, name: 'Verse' }),
    { type: 'MARKER_ADD', beat: 32, name: 'Chorus' },
  );

  it('keeps one chord per beat, sorted, and drops a bass equal to the root', () => {
    let s = fresh();
    s = reducer(s, { type: 'CHORD_SET', beat: 8, chord: Am });
    s = reducer(s, { type: 'CHORD_SET', beat: 0, chord: { ...C, bass: 0 } });
    s = reducer(s, { type: 'CHORD_SET', beat: 8, chord: C }); // replaces Am
    expect(s.sequencer.chords.map((c) => [c.beat, c.root])).toEqual([[0, 0], [8, 0]]);
    expect(s.sequencer.chords[0].bass).toBeUndefined();
  });

  it('moving a chord onto another replaces it', () => {
    let s = fresh();
    s = reducer(s, { type: 'CHORD_SET', beat: 0, chord: C });
    s = reducer(s, { type: 'CHORD_SET', beat: 4, chord: Am });
    const am = s.sequencer.chords.find((c) => c.root === 9)!;
    s = reducer(s, { type: 'CHORD_UPDATE', id: am.id, patch: { beat: 0 } });
    expect(s.sequencer.chords).toHaveLength(1);
    expect(s.sequencer.chords[0]).toMatchObject({ beat: 0, root: 9 });
  });

  it('replaces chords only inside the range', () => {
    let s = fresh();
    for (const beat of [0, 4, 8, 12]) s = reducer(s, { type: 'CHORD_SET', beat, chord: C });
    s = reducer(s, { type: 'CHORDS_REPLACE', fromBeat: 4, toBeat: 12, chords: [{ beat: 4, ...Am }] });
    expect(s.sequencer.chords.map((c) => [c.beat, c.root])).toEqual([[0, 0], [4, 9], [12, 0]]);
  });

  it('duplicating a section copies its chords, and the held chord carries into the copy', () => {
    let s = withMarkers();
    s = reducer(s, { type: 'CHORD_SET', beat: 0, chord: C });
    s = reducer(s, { type: 'CHORD_SET', beat: 20, chord: Am }); // inside Verse, not at its start
    const verse = s.sequencer.markers.find((m) => m.name === 'Verse')!;
    s = reducer(s, { type: 'SECTION_DUPLICATE', markerId: verse.id });
    // The copy starts on C (still sounding when Verse began), then Am four beats in
    expect(s.sequencer.chords.map((c) => [c.beat, c.root])).toEqual([[0, 0], [20, 9], [32, 0], [36, 9]]);
  });

  it('deleting a section removes its chords, keeps the next section\'s harmony, and pulls later ones in', () => {
    let s = withMarkers();
    s = reducer(s, { type: 'CHORD_SET', beat: 4, chord: Am });  // held into Verse
    s = reducer(s, { type: 'CHORD_SET', beat: 20, chord: C });
    const intro = s.sequencer.markers.find((m) => m.beat === 0)!;
    s = reducer(s, { type: 'SECTION_DELETE', markerId: intro.id });
    expect(s.sequencer.chords.map((c) => [c.beat, c.root])).toEqual([[0, 9], [4, 0]]);
  });

  it('is part of the undo history', () => {
    let s = fresh();
    s = reducer(s, { type: 'SEQ_PUSH_UNDO' });
    s = reducer(s, { type: 'CHORD_SET', beat: 0, chord: C });
    s = reducer(s, { type: 'SEQ_UNDO' });
    expect(s.sequencer.chords).toEqual([]);
    s = reducer(s, { type: 'SEQ_REDO' });
    expect(s.sequencer.chords).toHaveLength(1);
  });

  it('round-trips through a project file with the chosen key, and ignores bad entries', () => {
    const s = fresh();
    const chords = [{ id: 'a', beat: 0, root: 9, quality: 'm7' as const, bass: 4 }];
    const file = serializeProject({
      name: 'T', bpm: 120, beatsPerBar: 4, songLengthBars: 4,
      loop: { enabled: false, startBeat: 0, endBeat: 16 }, masterVolume: 0.8,
      doc: { tracks: s.sequencer.tracks, patterns: s.sequencer.patterns, markers: s.sequencer.markers, chords },
      songKey: { tonic: 9, mode: 'minor' },
      allDrumPatterns: [], allOscillators: s.tabs, effects: DEFAULT_EFFECTS,
    });
    const raw = JSON.parse(JSON.stringify(file));
    raw.chords.push({ beat: 4, root: 99, quality: 'maj' }, { beat: 'x' }, null);
    const loaded = parseProject(raw);
    expect(loaded.doc.chords).toHaveLength(1);
    expect(loaded.doc.chords[0]).toMatchObject({ beat: 0, root: 9, quality: 'm7', bass: 4 });
    expect(loaded.songKey).toEqual({ tonic: 9, mode: 'minor' });
    // Files from before the chord track load with none
    delete raw.chords; delete raw.songKey;
    const old = parseProject(raw);
    expect(old.doc.chords).toEqual([]);
    expect(old.songKey).toBeNull();
  });
});

describe('written parts', () => {
  const notes = [{ midiNote: 45, startBeat: 0, durationBeats: 1, velocity: 100 }];

  it('adds a new track with a clip per part, selected, as one undo step', () => {
    let s = fresh();
    const before = s.sequencer.tracks.length;
    s = reducer(s, {
      type: 'PART_ADD', target: { source: { type: 'preset', presetId: 'bass-sub' }, name: 'Bass 2' },
      clips: [{ startBeat: 0, lengthBeats: 16, name: 'Bass Intro', notes }, { startBeat: 16, lengthBeats: 16, name: 'Bass Verse', notes }],
    });
    const track = s.sequencer.tracks.at(-1)!;
    expect(s.sequencer.tracks).toHaveLength(before + 1);
    expect(track).toMatchObject({ name: 'Bass 2', source: { type: 'preset', presetId: 'bass-sub' } });
    expect(track.clips.map((c) => [c.startBeat, c.lengthBeats])).toEqual([[0, 16], [16, 16]]);
    expect(s.sequencer.patterns[track.clips[0].patternId]).toMatchObject({ name: 'Bass Intro', lengthBeats: 16 });
    expect(s.sequencer.patterns[track.clips[0].patternId].notes[0].id).toBeTruthy();
    expect(s.sequencer.selectedClipId).toBe(track.clips[0].id);
    expect(autoUndoKey({ type: 'PART_ADD', target: { trackId: track.id }, clips: [] })).toBeNull();
  });

  it('replaces what an existing track had in the range, keeping the rest of a crossing clip', () => {
    let s = fresh();
    const id = s.sequencer.tracks[1].id;
    s = reducer(s, { type: 'CLIP_ADD', trackId: id, startBeat: 0, lengthBeats: 32 });
    s = reducer(s, { type: 'PART_ADD', target: { trackId: id }, clips: [{ startBeat: 8, lengthBeats: 8, name: 'Bass', notes }] });
    const clips = s.sequencer.tracks.find((t) => t.id === id)!.clips;
    expect(clips.map((c) => [c.startBeat, c.lengthBeats, c.offsetBeats])).toEqual([[0, 8, 0], [8, 8, 0], [16, 16, 16]]);
  });

  it('writes clips and automation onto several tracks at once, replacing points in the spans', () => {
    let s = fresh();
    s = reducer(s, {
      type: 'TRACKS_WRITE',
      writes: [{
        target: { source: { type: 'preset', presetId: 'fx-noise-sweep' }, name: 'Risers' },
        clips: [{ startBeat: 8, lengthBeats: 8, name: 'Riser', notes: [{ midiNote: 60, startBeat: 0, durationBeats: 8, velocity: 100 }] }],
        lanes: [{ target: 'cutoff', points: [{ beat: 8, value: 0.1 }, { beat: 16, value: 0.9 }], spans: [{ from: 8, to: 16 }] }],
      }],
    });
    const risers = s.sequencer.tracks.at(-1)!;
    expect(risers.name).toBe('Risers');
    expect(risers.lanes.find((l) => l.target === 'cutoff')!.points.map((p) => p.beat)).toEqual([8, 16]);
    // Writing again over the same span replaces those points instead of piling up
    s = reducer(s, {
      type: 'TRACKS_WRITE',
      writes: [{
        target: { trackId: risers.id },
        clips: [{ startBeat: 8, lengthBeats: 8, name: 'Riser', notes: [{ midiNote: 60, startBeat: 0, durationBeats: 8, velocity: 100 }] }],
        lanes: [{ target: 'cutoff', points: [{ beat: 12, value: 0.1 }, { beat: 16, value: 0.9 }], spans: [{ from: 8, to: 16 }] }],
      }],
    });
    const again = s.sequencer.tracks.find((t) => t.id === risers.id)!;
    expect(again.clips).toHaveLength(1);
    expect(again.lanes.find((l) => l.target === 'cutoff')!.points.map((p) => p.beat)).toEqual([12, 16]);
  });

  it('refuses a drum track', () => {
    const s = fresh();
    const drums = s.sequencer.tracks.find((t) => t.source.type === 'drums')!;
    expect(reducer(s, { type: 'PART_ADD', target: { trackId: drums.id }, clips: [{ startBeat: 0, lengthBeats: 4, name: 'x', notes }] })).toBe(s);
  });
});

describe('undo', () => {
  it('skips no-op undo steps and restores the whole document', () => {
    let s = fresh();
    s = reducer(s, { type: 'SEQ_PUSH_UNDO' });
    s = reducer(s, { type: 'SEQ_PUSH_UNDO' }); // nothing changed in between
    expect(s.sequencer.undoStack).toHaveLength(1);

    s = reducer(s, { type: 'CLIP_ADD', trackId: s.sequencer.tracks[1].id, startBeat: 0, lengthBeats: 4 });
    expect(s.sequencer.selectedClipId).not.toBeNull();
    s = reducer(s, { type: 'SEQ_UNDO' });
    expect(s.sequencer.tracks[1].clips).toHaveLength(0);
    // Selection pointing at the undone clip is cleared
    expect(s.sequencer.selectedClipId).toBeNull();
    s = reducer(s, { type: 'SEQ_REDO' });
    expect(s.sequencer.tracks[1].clips).toHaveLength(1);
  });
  it('restores tempo, song length and other stores\' state', () => {
    let s = fresh();
    const drums = [{ id: 'dp', name: 'A', genre: 'x', stepCount: 16, swing: 0, voices: [] }];
    s = reducer(s, { type: 'SEQ_PUSH_UNDO', extras: { drums } });
    s = reducer(s, { type: 'SEQ_SET_BPM', bpm: 140 });
    s = reducer(s, { type: 'SEQ_SET_SONG_LENGTH', bars: 40 });
    const later = [...drums];
    s = reducer(s, { type: 'SEQ_UNDO', extras: { drums: later } });
    expect(s.sequencer.bpm).toBe(120);
    expect(s.sequencer.songLengthBars).toBe(16);
    // The drum store gets its recorded patterns back through an effect
    expect(s.sequencer.pendingRestore?.extras.drums).toBe(drums);
    s = reducer(s, { type: 'SEQ_REDO', extras: { drums } });
    expect(s.sequencer.bpm).toBe(140);
    expect(s.sequencer.pendingRestore?.extras.drums).toBe(later);
  });

  it('counts a change in another store as an undo step, and nothing else', () => {
    let s = fresh();
    const a = { reverbSize: 1 };
    s = reducer(s, { type: 'SEQ_PUSH_UNDO', extras: { fx: a } });
    s = reducer(s, { type: 'SEQ_PUSH_UNDO', extras: { fx: a } });
    expect(s.sequencer.undoStack).toHaveLength(1);
    s = reducer(s, { type: 'SEQ_PUSH_UNDO', extras: { fx: { reverbSize: 2 } } });
    expect(s.sequencer.undoStack).toHaveLength(2);
  });

  it('gives each track its own instrument settings, cleared by a new sound', () => {
    let s = fresh();
    const t = s.sequencer.tracks.find((x) => x.source.type === 'preset')!;
    s = reducer(s, { type: 'TRACK_SET_PATCH', trackId: t.id, patch: { cutoff: 800 } });
    s = reducer(s, { type: 'TRACK_SET_PATCH', trackId: t.id, patch: { release: 2 } });
    expect(s.sequencer.tracks.find((x) => x.id === t.id)!.patch).toEqual({ cutoff: 800, release: 2 });
    s = reducer(s, { type: 'TRACK_SET_SOURCE', trackId: t.id, source: { type: 'preset', presetId: 'pad-warm' } });
    expect(s.sequencer.tracks.find((x) => x.id === t.id)!.patch).toEqual({});
  });

  it('drops note patterns no clip uses when saving the session', () => {
    let s = fresh();
    const t = s.sequencer.tracks.find((x) => x.source.type === 'preset')!;
    s = reducer(s, { type: 'CLIP_ADD', trackId: t.id, startBeat: 0, lengthBeats: 4 });
    const clip = findClip(s.sequencer, s.sequencer.selectedClipId)!.clip;
    expect(Object.keys(referencedPatterns(s.sequencer))).toContain(clip.patternId);
    s = reducer(s, { type: 'CLIP_DELETE', clipId: clip.id });
    expect(s.sequencer.patterns[clip.patternId]).toBeDefined(); // kept for undo
    expect(referencedPatterns(s.sequencer)[clip.patternId]).toBeUndefined();
  });

  it('records mixer and track edits, coalescing a single control gesture', () => {
    const id = 't';
    const fader = autoUndoKey({ type: 'SEQ_SET_CHANNEL', trackId: id, channel: { gain: 0.5 } });
    expect(fader).toBe(autoUndoKey({ type: 'SEQ_SET_CHANNEL', trackId: id, channel: { gain: 0.6 } }));
    expect(fader).not.toBe(autoUndoKey({ type: 'SEQ_SET_CHANNEL', trackId: id, channel: { eqLow: 2 } }));
    // Toggles and structural edits are one step each
    expect(autoUndoKey({ type: 'TRACK_UPDATE', trackId: id, patch: { muted: true } })).toBeNull();
    expect(autoUndoKey({ type: 'TRACK_ADD', source: { type: 'drums' } })).toBeNull();
    // View state and transport aren't song edits
    expect(autoUndoKey({ type: 'TRACK_UPDATE', trackId: id, patch: { showAutomation: true } })).toBeUndefined();
    expect(autoUndoKey({ type: 'SEQ_SET_PLAYHEAD', beat: 4 })).toBeUndefined();

    // A fader move is undoable end to end
    let s = fresh();
    const track = s.sequencer.tracks[0];
    s = reducer(s, { type: 'SEQ_PUSH_UNDO' });
    s = reducer(s, { type: 'SEQ_SET_CHANNEL', trackId: track.id, channel: { gain: 0.2 } });
    s = reducer(s, { type: 'SEQ_UNDO' });
    expect(s.sequencer.tracks[0].channel.gain).toBe(track.channel.gain);
  });
});

describe('loop', () => {
  it('normalises a backwards loop range', () => {
    const s = reducer(fresh(), { type: 'SEQ_SET_LOOP', startBeat: 12, endBeat: 4 });
    expect([s.sequencer.loopStartBeat, s.sequencer.loopEndBeat]).toEqual([4, 12]);
  });
});

describe('project files', () => {
  it('loads a v1 file with instruments chosen from each part', () => {
    const p = parseProject({
      version: '1.0', bpm: 100, beatsPerBar: 4, songLengthBars: 2,
      tracks: [
        { tabId: '0', notes: [{ id: 'x', midiNote: 36, startBeat: 0, durationBeats: 1, velocity: 100 }], pan: 0 },
        { tabId: '1', notes: [], pan: 0 },
      ],
    });
    expect(p.doc.tracks[0].source).toEqual({ type: 'preset', presetId: 'bass-sub' });
    expect(p.doc.tracks[1].clips).toHaveLength(0);
    expect(p.loop).toEqual({ enabled: true, startBeat: 0, endBeat: 8 });
  });

  it('round-trips a v2 project, shipping only the drum patterns it uses', () => {
    const s = fresh();
    const doc = { tracks: s.sequencer.tracks, patterns: s.sequencer.patterns, markers: s.sequencer.markers, chords: [] };
    const drumTrack = doc.tracks[0];
    drumTrack.clips = [{ id: 'c', patternId: 'dp-used', startBeat: 0, lengthBeats: 4, offsetBeats: 0, muted: false }];
    const file = serializeProject({
      name: 'T', bpm: 120, beatsPerBar: 4, songLengthBars: 4,
      loop: { enabled: false, startBeat: 0, endBeat: 16 }, masterVolume: 0.8, doc,
      allDrumPatterns: [
        { id: 'dp-used', name: 'A', genre: 'x', stepCount: 16, swing: 0, voices: [] },
        { id: 'dp-unused', name: 'B', genre: 'x', stepCount: 16, swing: 0, voices: [] },
      ],
      allOscillators: s.tabs,
      effects: DEFAULT_EFFECTS,
    });
    expect(file.drumPatterns.map((d) => d.id)).toEqual(['dp-used']);
    expect(file.oscillators).toHaveLength(0); // nothing uses an oscillator

    const loaded = parseProject(JSON.parse(JSON.stringify(file)));
    expect(loaded.doc.tracks[0].clips).toHaveLength(1);
    expect(loaded.warnings).toEqual([]);
  });

  it('carries the master effects and each track\'s instrument settings', () => {
    const s = fresh();
    const keys = s.sequencer.tracks.find((t) => t.source.type === 'preset')!;
    const presetId = keys.source.type === 'preset' ? keys.source.presetId : '';
    const tracks = s.sequencer.tracks.map((t) => (t.id === keys.id ? { ...t, patch: { cutoff: 900 } } : t));
    const file = serializeProject({
      name: 'T', bpm: 120, beatsPerBar: 4, songLengthBars: 4,
      loop: { enabled: false, startBeat: 0, endBeat: 16 }, masterVolume: 0.8,
      doc: { tracks, patterns: {}, markers: [], chords: [] },
      allDrumPatterns: [], allOscillators: [],
      effects: { ...DEFAULT_EFFECTS, reverbSize: 5, delayDivision: '1/16' },
      // A library-wide edit to the same preset: baked in, the track's own value wins
      libraryOverrides: { [presetId]: { cutoff: 2000, release: 1.5 } },
    });
    const loaded = parseProject(JSON.parse(JSON.stringify(file)));
    expect(loaded.effects.reverbSize).toBe(5);
    expect(loaded.effects.delayDivision).toBe('1/16');
    expect(loaded.doc.tracks.find((t) => t.id === keys.id)!.patch).toEqual({ cutoff: 900, release: 1.5 });
  });

  it('falls back to default effects for older files and rejects bad values', () => {
    expect(parseEffects(undefined)).toEqual(DEFAULT_EFFECTS);
    const e = parseEffects({ reverbMix: 'loud', delayDivision: '1/3', chorusRate: 2, limiterEnabled: false });
    expect(e.reverbMix).toBe(DEFAULT_EFFECTS.reverbMix);
    expect(e.delayDivision).toBe(DEFAULT_EFFECTS.delayDivision);
    expect(e.chorusRate).toBe(2);
    expect(e.limiterEnabled).toBe(false);
  });

  it('rejects files that are not projects', () => {
    expect(() => parseProject({ hello: 'world' })).toThrow();
    expect(() => parseProject(null)).toThrow();
  });

  it('guesses sensible instruments', () => {
    expect(guessPresetForNotes([{ id: '', midiNote: 33, startBeat: 0, durationBeats: 1, velocity: 1 }])).toBe('bass-sub');
    expect(guessPresetForNotes([{ id: '', midiNote: 60, startBeat: 0, durationBeats: 4, velocity: 1 }])).toBe('pad-warm');
  });
});
