/**
 * Project files and saved-session migration.
 *
 * v1 (.oscproject "1.0") tied each track to an oscillator tab by index and kept
 * notes in absolute song beats. v2 stores tracks with their own sound source,
 * clips that reference patterns, and section markers — and carries the drum
 * patterns and oscillator settings it uses, so a file is self-contained.
 */

import {
  makeClip, makePattern, makeTrack, normalizeTrack, uid,
  type DocSnapshot, type Marker, type Pattern, type SequencerNote, type Track,
  type TrackSource, type ArpSettings, type ChannelSettings, type AutomationLane,
} from './music';
import type { DrumPattern } from '../store/drumStore';
import type { OscillatorTab } from '../engine/oscillator';
import { DEFAULT_EFFECTS, DELAY_DIVISIONS, type EffectsSettings } from '../engine/effects';
import type { InstrumentPatch } from './music';

// ─── Formats ──────────────────────────────────────────────────────────────────

export interface ProjectV2 {
  format: 'osc-project';
  version: 2;
  name: string;
  savedAt: string;
  bpm: number;
  beatsPerBar: number;
  songLengthBars: number;
  loop: { enabled: boolean; startBeat: number; endBeat: number };
  masterVolume: number;
  tracks: Track[];
  patterns: Pattern[];
  markers: Marker[];
  /** Drum patterns referenced by drum clips. */
  drumPatterns: DrumPattern[];
  /** Oscillator lab tabs referenced by oscillator-source tracks. */
  oscillators: OscillatorTab[];
  /** Master effects. Files saved before this field existed use the defaults. */
  effects?: EffectsSettings;
}

/** A track as v1 projects and pre-v2 sessions stored it. */
export interface LegacyTrack {
  tabId: string;
  notes?: SequencerNote[];
  pan?: number;
  arp?: Partial<ArpSettings>;
  channel?: Partial<ChannelSettings>;
  lanes?: AutomationLane[];
}

interface LegacyProject {
  version: string;
  name?: string;
  bpm: number;
  beatsPerBar?: number;
  songLengthBars?: number;
  masterVolume?: number;
  tracks: LegacyTrack[];
}

/** What loading a project hands back to the stores. */
export interface LoadedProject {
  name: string;
  bpm: number;
  beatsPerBar: number;
  songLengthBars: number;
  loop: { enabled: boolean; startBeat: number; endBeat: number };
  masterVolume: number;
  doc: DocSnapshot;
  drumPatterns: DrumPattern[];
  oscillators: OscillatorTab[];
  /** Master effects the project was made with. */
  effects: EffectsSettings;
  /** Human-readable notes about anything that needed migrating. */
  warnings: string[];
}

// ─── Instrument guess for tracks that never had one ───────────────────────────

/**
 * v1 files don't record which instrument a track used, so pick a sensible
 * starting point from the part itself. The user can change it in one click;
 * the point is that a loaded project makes sound immediately.
 */
export function guessPresetForNotes(notes: SequencerNote[]): string {
  if (notes.length === 0) return 'keys-epiano';
  const avgPitch = notes.reduce((s, n) => s + n.midiNote, 0) / notes.length;
  const avgDur = notes.reduce((s, n) => s + n.durationBeats, 0) / notes.length;
  if (avgPitch < 48) return 'bass-sub';
  if (avgDur >= 2.5) return 'pad-warm';
  if (avgPitch >= 72) return 'lead-bell';
  if (avgDur <= 0.3) return 'pluck-analog';
  return 'keys-epiano';
}

// ─── Legacy track → v2 track ──────────────────────────────────────────────────

/**
 * Turn an old absolute-time track into a track with one clip spanning its
 * content. The clip starts at bar 1 so every note keeps its exact position.
 */
export function legacyTrackToV2(
  lt: LegacyTrack,
  index: number,
  opts: { songBeats: number; beatsPerBar: number; source: TrackSource; name?: string; color?: string },
): { track: Track; pattern: Pattern | null } {
  const track = normalizeTrack({
    ...makeTrack({ name: opts.name ?? `Track ${index + 1}`, source: opts.source, index, color: opts.color }),
    pan: lt.pan ?? 0,
    arp: { ...makeTrack({ name: '', source: opts.source }).arp, ...lt.arp },
    channel: { ...makeTrack({ name: '', source: opts.source }).channel, ...lt.channel },
    lanes: lt.lanes ?? [],
  }, index);

  const notes = (lt.notes ?? []).filter((n) => Number.isFinite(n.startBeat) && n.durationBeats > 0);
  if (notes.length === 0) return { track, pattern: null };

  const lastEnd = Math.max(...notes.map((n) => n.startBeat + n.durationBeats));
  const bar = Math.max(1, opts.beatsPerBar);
  const length = Math.max(opts.songBeats, Math.ceil(lastEnd / bar) * bar);

  const pattern = makePattern(`${track.name} 1`, length, notes.map((n) => ({ ...n })));
  track.clips = [makeClip(pattern.id, 0, length)];
  return { track, pattern };
}

// ─── Saving ───────────────────────────────────────────────────────────────────

export function serializeProject(input: {
  name: string;
  bpm: number;
  beatsPerBar: number;
  songLengthBars: number;
  loop: { enabled: boolean; startBeat: number; endBeat: number };
  masterVolume: number;
  doc: DocSnapshot;
  allDrumPatterns: DrumPattern[];
  allOscillators: OscillatorTab[];
  effects: EffectsSettings;
  /** The instrument library's own edits, per preset (they apply to every track using it). */
  libraryOverrides?: Record<string, InstrumentPatch>;
}): ProjectV2 {
  const { doc } = input;
  const lib = input.libraryOverrides ?? {};

  // Only ship what the arrangement actually uses
  const usedNotePatterns = new Set<string>();
  const usedDrumPatterns = new Set<string>();
  const usedTabs = new Set<string>();
  for (const t of doc.tracks) {
    if (t.source.type === 'oscillator') usedTabs.add(t.source.tabId);
    for (const c of t.clips) {
      (t.source.type === 'drums' ? usedDrumPatterns : usedNotePatterns).add(c.patternId);
    }
  }

  return {
    format: 'osc-project',
    version: 2,
    name: input.name,
    savedAt: new Date().toISOString(),
    bpm: input.bpm,
    beatsPerBar: input.beatsPerBar,
    songLengthBars: input.songLengthBars,
    loop: input.loop,
    masterVolume: input.masterVolume,
    // Library edits are folded into each track's patch, so the file sounds
    // the same on a machine whose instrument library was never touched
    tracks: doc.tracks.map((t) => ({
      ...t,
      solo: false,
      patch: t.source.type === 'preset' ? { ...lib[t.source.presetId], ...t.patch } : t.patch,
    })),
    patterns: Object.values(doc.patterns).filter((p) => usedNotePatterns.has(p.id)),
    markers: doc.markers,
    drumPatterns: input.allDrumPatterns
      .filter((p) => usedDrumPatterns.has(p.id))
      .map((p) => ({ ...p, voices: p.voices.map((v) => ({ ...v, solo: false })) })),
    oscillators: input.allOscillators
      .filter((t) => usedTabs.has(t.id))
      .map((t) => ({ ...t, isPlaying: false })),
    effects: { ...input.effects },
  };
}

/**
 * Effects from a file: known fields of the right type over the defaults, so a
 * hand-edited or newer file can't put garbage into the audio graph.
 */
export function parseEffects(raw: unknown): EffectsSettings {
  const out: EffectsSettings = { ...DEFAULT_EFFECTS };
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_EFFECTS) as (keyof EffectsSettings)[]) {
    const v = src[k];
    const def = DEFAULT_EFFECTS[k];
    if (k === 'delayDivision') {
      if (typeof v === 'string' && (DELAY_DIVISIONS as string[]).includes(v)) out.delayDivision = v as EffectsSettings['delayDivision'];
    } else if (typeof def === 'number' && typeof v === 'number' && Number.isFinite(v)) {
      (out as unknown as Record<string, number>)[k] = v;
    } else if (typeof def === 'boolean' && typeof v === 'boolean') {
      (out as unknown as Record<string, boolean>)[k] = v;
    }
  }
  return out;
}

// ─── Loading ──────────────────────────────────────────────────────────────────

export class ProjectError extends Error {}

export function parseProject(raw: unknown): LoadedProject {
  if (!raw || typeof raw !== 'object') throw new ProjectError('Not a project file.');
  const obj = raw as Record<string, unknown>;

  if (obj.format === 'osc-project' && obj.version === 2) return loadV2(obj as unknown as ProjectV2);
  if (typeof obj.version === 'string' && Array.isArray(obj.tracks)) {
    return loadV1(obj as unknown as LegacyProject);
  }
  throw new ProjectError('Unrecognised project format.');
}

function loadV2(p: ProjectV2): LoadedProject {
  if (!Number.isFinite(p.bpm) || !Array.isArray(p.tracks)) {
    throw new ProjectError('Project is missing its tempo or tracks.');
  }
  const warnings: string[] = [];
  const patterns: Record<string, Pattern> = {};
  for (const pat of p.patterns ?? []) patterns[pat.id] = { ...pat, notes: pat.notes ?? [] };

  const drumIds = new Set((p.drumPatterns ?? []).map((d) => d.id));
  const tabIds = new Set((p.oscillators ?? []).map((t) => t.id));

  const tracks = p.tracks.map((t, i) => {
    const track = normalizeTrack(t, i);
    // Drop clips whose pattern didn't make it into the file rather than
    // crashing the scheduler on a missing reference later.
    const before = track.clips.length;
    track.clips = track.clips.filter((c) =>
      track.source.type === 'drums' ? drumIds.has(c.patternId) : !!patterns[c.patternId]);
    if (track.clips.length < before) {
      warnings.push(`${track.name}: ${before - track.clips.length} clip(s) referenced missing patterns and were skipped.`);
    }
    if (track.source.type === 'oscillator' && !tabIds.has(track.source.tabId)) {
      track.source = { type: 'preset', presetId: 'keys-epiano' };
      warnings.push(`${track.name}: its oscillator wasn't in the file, so it now uses Electric Piano.`);
    }
    return track;
  });

  return {
    name: p.name || 'Untitled',
    bpm: clampBpm(p.bpm),
    beatsPerBar: p.beatsPerBar || 4,
    songLengthBars: Math.max(1, p.songLengthBars || 16),
    loop: p.loop ?? { enabled: false, startBeat: 0, endBeat: 16 },
    masterVolume: p.masterVolume ?? 0.8,
    doc: { tracks, patterns, markers: (p.markers ?? []).map((m) => ({ ...m })) },
    drumPatterns: p.drumPatterns ?? [],
    oscillators: p.oscillators ?? [],
    effects: parseEffects(p.effects),
    warnings,
  };
}

function loadV1(p: LegacyProject): LoadedProject {
  if (!Number.isFinite(p.bpm)) throw new ProjectError('Project is missing its tempo.');
  const beatsPerBar = p.beatsPerBar || 4;
  const songLengthBars = Math.max(1, p.songLengthBars || 8);
  const songBeats = songLengthBars * beatsPerBar;

  const tracks: Track[] = [];
  const patterns: Record<string, Pattern> = {};
  p.tracks.forEach((lt, i) => {
    const presetId = guessPresetForNotes(lt.notes ?? []);
    const { track, pattern } = legacyTrackToV2(lt, i, {
      songBeats, beatsPerBar, source: { type: 'preset', presetId },
    });
    tracks.push(track);
    if (pattern) patterns[pattern.id] = pattern;
  });

  return {
    name: p.name || 'Untitled',
    bpm: clampBpm(p.bpm),
    beatsPerBar,
    songLengthBars,
    // v1 projects looped their whole length by default
    loop: { enabled: true, startBeat: 0, endBeat: songBeats },
    masterVolume: p.masterVolume ?? 0.8,
    doc: { tracks, patterns, markers: [] },
    drumPatterns: [],
    oscillators: [],
    effects: { ...DEFAULT_EFFECTS },
    warnings: ['Converted from an older project format. Instruments were chosen from each part\'s range — change any of them from the track header.'],
  };
}

function clampBpm(bpm: number): number {
  return Math.max(20, Math.min(300, Math.round(bpm)));
}

// ─── Saved-session migration ──────────────────────────────────────────────────

/**
 * Bring a pre-v2 localStorage session forward. Unlike a v1 file, a session
 * still has its oscillator tabs and the instrument assignments made in the
 * library, so each track keeps exactly the sound it had: its assigned preset
 * if it had one, otherwise the oscillator tab it was bound to.
 */
export function migrateLegacySequencer(
  legacyTracks: LegacyTrack[],
  tabs: { id: string; label: string; color: string }[],
  assignments: Record<string, string>,
  songBeats: number,
  beatsPerBar: number,
): DocSnapshot {
  const tracks: Track[] = [];
  const patterns: Record<string, Pattern> = {};

  legacyTracks.forEach((lt, i) => {
    const tab = tabs.find((t) => t.id === lt.tabId);
    const preset = assignments[lt.tabId];
    const source: TrackSource = preset
      ? { type: 'preset', presetId: preset }
      : tab
        ? { type: 'oscillator', tabId: tab.id }
        : { type: 'preset', presetId: guessPresetForNotes(lt.notes ?? []) };

    const { track, pattern } = legacyTrackToV2(lt, i, {
      songBeats, beatsPerBar, source,
      name: tab?.label, color: tab?.color,
    });
    tracks.push(track);
    if (pattern) patterns[pattern.id] = pattern;
  });

  return { tracks, patterns, markers: [] };
}

export function isLegacyTrackList(tracks: unknown): tracks is LegacyTrack[] {
  return Array.isArray(tracks) && tracks.length > 0 &&
    typeof (tracks[0] as Record<string, unknown>).tabId === 'string' &&
    !('clips' in (tracks[0] as Record<string, unknown>));
}

/** Starter arrangement for a brand-new session. */
export function makeStarterDoc(): DocSnapshot {
  const drums = makeTrack({ name: 'Drums', source: { type: 'drums' }, index: 3 });
  const bass = makeTrack({ name: 'Bass', source: { type: 'preset', presetId: 'bass-saw' }, index: 2 });
  const keys = makeTrack({ name: 'Keys', source: { type: 'preset', presetId: 'keys-epiano' }, index: 0 });
  const pad = makeTrack({ name: 'Pad', source: { type: 'preset', presetId: 'pad-warm' }, index: 4 });
  return {
    tracks: [drums, bass, keys, pad],
    patterns: {},
    markers: [{ id: uid('mk'), beat: 0, name: 'Intro', color: '#6366f1' }],
  };
}
