/**
 * Offline (faster-than-real-time) rendering of the arrangement.
 *
 * The arrangement is played into an OfflineAudioContext by the same engines
 * that play it live — instruments, drums, channel strips, effects, limiter —
 * so an export sounds exactly like playback, sample-accurately, regardless of
 * CPU load or how long the song is.
 */

import { getAudioEngine } from '../engine/audio';
import { getInstrumentEngine } from '../engine/instruments';
import { getChannelRack } from '../engine/channelStrip';
import { getEffectsBus, type EffectsSettings } from '../engine/effects';
import { getSequencerEngine } from '../engine/sequencer';
import { expandArpCached } from '../engine/arpeggiator';
import { CHANNEL_TARGETS, scheduleLaneOnParam } from '../engine/automation';
import { eventsInWindow, type TimelineInput } from '../engine/timeline';
import { emitEvent } from '../engine/emit';
import type { SequencerState, Track } from '../utils/music';
import type { OscillatorTab } from '../engine/oscillator';
import type { DrumPattern } from '../store/drumStore';

export interface RenderInput {
  seq: SequencerState;
  tabs: OscillatorTab[];
  drumPatterns: DrumPattern[];
  effects: EffectsSettings;
  masterVolume: number;
}

export interface RenderOptions {
  startBeat: number;
  endBeat: number;
  sampleRate: number;
  /** Extra time after the range for release and reverb tails. Silence is trimmed off. */
  maxTailSeconds: number;
  /** Render only this track (with its sends and the master chain) — for stems. */
  soloTrackId?: string | null;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export class RenderCancelled extends Error {
  constructor() { super('Export cancelled'); }
}

/** Beats rendered per scheduling chunk; later chunks are added while rendering. */
const CHUNK_BEATS = 16;
/** Level below which the tail counts as silence when trimming (−80 dBFS). */
const SILENCE = 1e-4;

/** Tracks that produce sound in this render. */
export function audibleTracks(tracks: Track[], soloTrackId?: string | null): Track[] {
  if (soloTrackId) return tracks.filter((t) => t.id === soloTrackId);
  const anySolo = tracks.some((t) => t.solo);
  return tracks.filter((t) => !t.muted && (!anySolo || t.solo));
}

export async function renderArrangement(input: RenderInput, opts: RenderOptions): Promise<AudioBuffer> {
  const { seq } = input;
  const bps = seq.bpm / 60;
  const rangeSeconds = Math.max(0.05, (opts.endBeat - opts.startBeat) / bps);
  const totalSeconds = rangeSeconds + Math.max(0, opts.maxTailSeconds);
  const frames = Math.ceil(totalSeconds * opts.sampleRate);

  const ctx = new OfflineAudioContext(2, frames, opts.sampleRate);
  const audio = getAudioEngine();
  audio.beginOffline(ctx, input.masterVolume);
  const restoreVoices = getInstrumentEngine().unlimitVoices();

  try {
    // ── Mix state for this render ──
    // Stems solo one track; a mixdown honours the session's mute and solo.
    const tracks = seq.tracks.map((t) => ({
      ...t,
      muted: opts.soloTrackId ? t.id !== opts.soloTrackId : t.muted,
      solo: opts.soloTrackId ? false : t.solo,
    }));
    const renderSeq: SequencerState = { ...seq, tracks };
    getEffectsBus().update(input.effects, seq.bpm);
    getSequencerEngine().applyMixState(renderSeq);

    // Channel automation is known in full up front, so write it in one pass
    const rack = getChannelRack();
    for (const t of tracks) {
      const params = rack.getParams(t.id);
      if (!params) continue;
      for (const lane of t.lanes) {
        if (!lane.enabled || lane.points.length === 0 || !CHANNEL_TARGETS.includes(lane.target)) continue;
        const param = params[lane.target as keyof typeof params];
        if (param) scheduleLaneOnParam(param, lane, 0, totalSeconds, opts.startBeat, seq.bpm);
      }
    }

    // ── Notes and hits ──
    const playing = audibleTracks(tracks);
    const timeline: TimelineInput = {
      tracks: playing,
      patterns: seq.patterns,
      drumPatterns: new Map(input.drumPatterns.map((p) => [p.id, p])),
      notesFor: (track, pattern) => expandArpCached(`${track.id}:${pattern.id}`, pattern.notes, track.arp),
      metronome: false,
      beatsPerBar: seq.beatsPerBar,
    };
    const tabs = new Map(input.tabs.map((t) => [t.id, t]));
    const scheduleChunk = (fromBeat: number) => {
      const to = Math.min(opts.endBeat, fromBeat + CHUNK_BEATS);
      const noLoop = { enabled: false, start: 0, end: 0 };
      for (const e of eventsInWindow(timeline, fromBeat, to, noLoop, false)) {
        emitEvent(e, (e.monoBeat - opts.startBeat) / bps, ctx, seq.bpm, tabs);
      }
    };

    // Scheduling everything at once would create every node of the song up
    // front. Instead, render pauses just before each chunk and adds it then.
    // (Browsers without offline suspend get the whole song in one go.)
    const canSuspend = typeof ctx.suspend === 'function';
    let cancelled = false;
    const onAbort = () => { cancelled = true; };
    opts.signal?.addEventListener('abort', onAbort);

    scheduleChunk(opts.startBeat);
    for (let b = opts.startBeat + CHUNK_BEATS; b < opts.endBeat; b += CHUNK_BEATS) {
      if (!canSuspend) { scheduleChunk(b); continue; }
      const at = Math.max(0.05, (b - opts.startBeat) / bps - 0.5);
      const quantum = 128 / opts.sampleRate;
      const suspendAt = Math.ceil(at / quantum) * quantum;
      const beat = b;
      void ctx.suspend(suspendAt).then(() => {
        if (cancelled) return; // leave it suspended; the context is discarded
        opts.onProgress?.(Math.min(0.99, suspendAt / totalSeconds));
        scheduleChunk(beat);
        void ctx.resume();
      });
    }

    const progressTimer = setInterval(() => {
      opts.onProgress?.(Math.min(0.99, ctx.currentTime / totalSeconds));
    }, 120);

    try {
      const rendered = await Promise.race([
        ctx.startRendering(),
        new Promise<never>((_, reject) => {
          if (opts.signal?.aborted) reject(new RenderCancelled());
          opts.signal?.addEventListener('abort', () => reject(new RenderCancelled()));
        }),
      ]);
      opts.onProgress?.(1);
      return trimTail(rendered, rangeSeconds);
    } finally {
      clearInterval(progressTimer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  } finally {
    restoreVoices();
    audio.endOffline();
    // Rebuild the live strips with the session's real mix state
    getSequencerEngine().applyMixState(seq);
  }
}

/**
 * Cut trailing silence after the range end, keeping a short fade margin so a
 * reverb tail ends naturally rather than mid-decay.
 */
export function trimTail(buf: AudioBuffer, minSeconds: number): AudioBuffer {
  const sr = buf.sampleRate;
  const minFrames = Math.min(buf.length, Math.ceil(minSeconds * sr));
  let last = minFrames;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = d.length - 1; i > last; i--) {
      if (Math.abs(d[i]) > SILENCE) { last = i; break; }
    }
  }
  const keep = Math.min(buf.length, last + Math.ceil(0.05 * sr));
  if (keep >= buf.length) return buf;

  const out = new AudioBuffer({ length: keep, numberOfChannels: buf.numberOfChannels, sampleRate: sr });
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    out.copyToChannel(buf.getChannelData(ch).subarray(0, keep), ch);
  }
  return out;
}

/** Audible tracks that have at least one clip overlapping the range. */
export function tracksWithContent(tracks: Track[], startBeat: number, endBeat: number): Track[] {
  return audibleTracks(tracks).filter((t) =>
    t.clips.some((c) => !c.muted && c.startBeat < endBeat && c.startBeat + c.lengthBeats > startBeat));
}

/** Render one stem per audible track that plays in the range — no empty files. */
export async function renderStems(
  input: RenderInput,
  opts: Omit<RenderOptions, 'soloTrackId' | 'onProgress'> & {
    onProgress?: (fraction: number, trackName: string) => void;
  },
): Promise<{ track: Track; buffer: AudioBuffer }[]> {
  const tracks = tracksWithContent(input.seq.tracks, opts.startBeat, opts.endBeat);
  const out: { track: Track; buffer: AudioBuffer }[] = [];
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const buffer = await renderArrangement(input, {
      ...opts,
      soloTrackId: t.id,
      onProgress: (f) => opts.onProgress?.((i + f) / tracks.length, t.name),
    });
    out.push({ track: t, buffer });
  }
  // All stems share one length so they line up when dropped into another DAW
  const len = Math.max(...out.map((s) => s.buffer.length));
  return out.map((s) => ({ ...s, buffer: padTo(s.buffer, len) }));
}

function padTo(buf: AudioBuffer, length: number): AudioBuffer {
  if (buf.length === length) return buf;
  const out = new AudioBuffer({ length, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let ch = 0; ch < buf.numberOfChannels; ch++) out.copyToChannel(buf.getChannelData(ch), ch);
  return out;
}
