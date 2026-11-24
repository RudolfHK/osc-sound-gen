/**
 * Listening against a reference: a finished track (yours or a favourite
 * record) plays in time with the song, and one switch flips between the mix
 * and the reference, level-matched so "louder" doesn't pass for "better".
 *
 * The reference goes straight to the speakers: it is never part of the mix,
 * a recording, an export or a saved file. Also here: the live loudness meter
 * for the mix (ITU-R BS.1770 momentary, short-term and integrated LUFS).
 */
import { useSyncExternalStore } from 'react';
import { getAudioEngine } from './audio';
import { blockLufs, gatedLoudness, highPass, highShelf, integratedLoudness, dbToGain } from '../export/loudness';

// ─── Live loudness meter ──────────────────────────────────────────────────────

export interface LoudnessReading {
  /** Last 400 ms. */
  momentary: number;
  /** Last 3 s. */
  shortTerm: number;
  /** Gated, since playback started (or the meter was reset). */
  integrated: number;
  /** Seconds of audio the integrated value covers. */
  seconds: number;
}

const SILENT: LoudnessReading = { momentary: -Infinity, shortTerm: -Infinity, integrated: -Infinity, seconds: 0 };
const HOP_MS = 100;
const MAX_BLOCKS = 36000; // an hour of 100 ms hops

/** Short-term loudness: the mean power of the 400 ms blocks over the last 3 s. */
export function shortTermOf(blocks: number[]): number {
  const recent = blocks.slice(-27); // 27 hops + one block ≈ 3 s
  if (!recent.length) return -Infinity;
  return blockLufs(recent.reduce((s, z) => s + z, 0) / recent.length);
}

class LiveLoudness {
  private ctx: BaseAudioContext | null = null;
  private analysers: AnalyserNode[] = [];
  private nodes: AudioNode[] = [];
  private buf: Float32Array<ArrayBuffer> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private blocks: number[] = [];
  reading: LoudnessReading = SILENT;
  /** The last integrated value worth trusting (≥ 3 s), kept across stops. */
  lastIntegrated = -Infinity;
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private emit() { for (const fn of this.listeners) fn(); }

  /** K-weighting with the standard's own coefficients, then one analyser per channel. */
  private attach(): boolean {
    const engine = getAudioEngine();
    const ctx = engine.getAudioContext();
    const out = engine.getOutputNode();
    if (!ctx || !out || engine.isRenderingOffline) return false;
    if (this.ctx === ctx) return true;
    this.detach();
    const fs = ctx.sampleRate;
    const s = highShelf(fs), h = highPass(fs);
    const shelf = ctx.createIIRFilter([s.b0, s.b1, s.b2], [1, s.a1, s.a2]);
    const hp = ctx.createIIRFilter([h.b0, h.b1, h.b2], [1, h.a1, h.a2]);
    const split = ctx.createChannelSplitter(2);
    out.connect(shelf);
    shelf.connect(hp);
    hp.connect(split);
    this.analysers = [0, 1].map((ch) => {
      const a = ctx.createAnalyser();
      a.fftSize = 32768; // ≥ 400 ms at up to 81 kHz
      split.connect(a, ch);
      return a;
    });
    this.nodes = [shelf, hp, split, ...this.analysers];
    this.buf = new Float32Array(new ArrayBuffer(32768 * 4));
    this.ctx = ctx;
    return true;
  }

  private detach() {
    const out = getAudioEngine().getOutputNode();
    try { if (this.nodes[0]) out?.disconnect(this.nodes[0]); } catch { /* already gone */ }
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* ignore */ } }
    this.nodes = [];
    this.analysers = [];
    this.ctx = null;
  }

  /** Measure while the song plays. `reset` starts the integrated value afresh. */
  start(reset = true): void {
    if (!this.attach()) return;
    if (reset) this.blocks = [];
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), HOP_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  reset(): void {
    this.blocks = [];
    this.reading = SILENT;
    this.emit();
  }

  private tick() {
    const ctx = this.ctx;
    const buf = this.buf;
    if (!ctx || !buf || getAudioEngine().isRenderingOffline) return;
    const n = Math.min(buf.length, Math.round(0.4 * ctx.sampleRate));
    let z = 0;
    for (const a of this.analysers) {
      a.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = buf.length - n; i < buf.length; i++) sum += buf[i] * buf[i];
      z += sum / n;
    }
    this.blocks.push(z);
    if (this.blocks.length > MAX_BLOCKS) this.blocks.shift();
    const integrated = gatedLoudness(this.blocks);
    const seconds = this.blocks.length * HOP_MS / 1000;
    if (seconds >= 3 && Number.isFinite(integrated)) this.lastIntegrated = integrated;
    this.reading = { momentary: z > 0 ? blockLufs(z) : -Infinity, shortTerm: shortTermOf(this.blocks), integrated, seconds };
    reference.onMixLoudness();
    this.emit();
  }
}

export const meter = new LiveLoudness();

export function useLoudness(): LoudnessReading {
  return useSyncExternalStore(meter.subscribe, () => meter.reading, () => meter.reading);
}

// ─── Reference track ──────────────────────────────────────────────────────────

export interface ReferenceState {
  name: string | null;
  duration: number;
  /** Integrated loudness of the whole reference. */
  lufs: number;
  loading: boolean;
  /** 'mix' is A (the song), 'reference' is B. */
  listening: 'mix' | 'reference';
  /** Turn the reference down (or up) to the mix's loudness. */
  match: boolean;
  /** The reference's position at the song's start, in seconds. */
  offset: number;
  /** Gain on the reference right now, in dB (for display). */
  gainDb: number;
}

/** How far the reference is moved to sit at the mix's loudness: within −30…+12 dB. */
export function matchGainDb(mixLufs: number, refLufs: number): number {
  if (!Number.isFinite(mixLufs) || !Number.isFinite(refLufs)) return 0;
  return Math.max(-30, Math.min(12, mixLufs - refLufs));
}

/** Loudness assumed for a mix that hasn't been measured yet: the streaming target. */
const UNMEASURED_MIX = -14;
/** Drift between the song and the reference before the reference is restarted. */
const RESYNC_S = 0.12;

class ReferencePlayer {
  state: ReferenceState = { name: null, duration: 0, lufs: -Infinity, loading: false, listening: 'mix', match: true, offset: 0, gainDb: 0 };
  private buffer: AudioBuffer | null = null;
  private gain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private started: { ctxTime: number; refPos: number } | null = null;
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(patch: Partial<ReferenceState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** Decode an audio file and measure its loudness. */
  async load(file: File): Promise<void> {
    this.set({ loading: true });
    try {
      const ctx = await getAudioEngine().getOrCreateAudioContext();
      const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
      const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) => buffer.getChannelData(i));
      const lufs = integratedLoudness({ sampleRate: buffer.sampleRate, channels });
      this.stopSource();
      this.buffer = buffer;
      this.set({ name: file.name, duration: buffer.duration, lufs, loading: false });
      this.applyGains();
    } catch (err) {
      this.set({ loading: false });
      throw err;
    }
  }

  clear(): void {
    this.stopSource();
    this.buffer = null;
    this.set({ name: null, duration: 0, lufs: -Infinity, listening: 'mix' });
    this.applyGains();
  }

  setListening(listening: 'mix' | 'reference'): void {
    if (listening === 'reference' && !this.buffer) return;
    this.set({ listening });
    this.applyGains();
  }

  /** A/B: false if there's no reference to switch to. */
  toggle(): boolean {
    if (!this.buffer) return false;
    this.setListening(this.state.listening === 'mix' ? 'reference' : 'mix');
    return true;
  }

  setMatch(match: boolean): void {
    this.set({ match });
    this.applyGains();
  }

  setOffset(offset: number): void {
    this.set({ offset: Math.max(-600, Math.min(600, offset)) });
    this.started = null; // resync on the next tick
    if (this.source) this.stopSource();
  }

  /** The mix's loudness changed: follow it (slowly) while matching. */
  onMixLoudness(): void {
    if (this.state.match && this.buffer) this.applyGains(0.5);
  }

  private ensureGain(): GainNode | null {
    const ctx = getAudioEngine().getAudioContext();
    if (!ctx) return null;
    if (!this.gain || this.gain.context !== ctx) {
      this.gain = ctx.createGain();
      this.gain.gain.value = 0;
      // Straight to the speakers: not the master bus, the recorder or an export
      this.gain.connect(ctx.destination);
    }
    return this.gain;
  }

  private applyGains(timeConstant = 0.007): void {
    const onRef = this.state.listening === 'reference' && !!this.buffer;
    const mix = meter.lastIntegrated > -Infinity ? meter.lastIntegrated : UNMEASURED_MIX;
    const db = this.state.match ? matchGainDb(mix, this.state.lufs) : 0;
    if (Math.abs(db - this.state.gainDb) > 0.05) this.set({ gainDb: db });
    getAudioEngine().setMonitorGain(onRef ? 0 : 1);
    const g = this.ensureGain();
    if (!g) return;
    const now = g.context.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setTargetAtTime(onRef ? dbToGain(db) : 0, now, timeConstant);
  }

  /**
   * Follow the song: `songSeconds` is where it is (null when stopped). The
   * reference restarts only when it has drifted, after a seek or a loop.
   */
  sync(songSeconds: number | null): void {
    if (!this.buffer || songSeconds === null) { this.stopSource(); return; }
    const g = this.ensureGain();
    if (!g) return;
    const ctx = g.context;
    const want = songSeconds + this.state.offset;
    if (this.source && this.started) {
      const at = this.started.refPos + (ctx.currentTime - this.started.ctxTime);
      if (Math.abs(at - want) < RESYNC_S) return;
    }
    this.stopSource();
    if (want >= this.buffer.duration) return;
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(g);
    // Before the reference begins (a negative offset), it starts a little later
    const delay = Math.max(0, -want);
    src.start(ctx.currentTime + delay, Math.max(0, want));
    this.source = src;
    this.started = { ctxTime: ctx.currentTime, refPos: want };
    this.applyGains();
  }

  private stopSource(): void {
    if (this.source) {
      try { this.source.stop(); } catch { /* not started */ }
      this.source.disconnect();
    }
    this.source = null;
    this.started = null;
  }
}

export const reference = new ReferencePlayer();

export function useReference(): ReferenceState {
  return useSyncExternalStore(reference.subscribe, () => reference.state, () => reference.state);
}
