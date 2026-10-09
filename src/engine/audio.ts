import { squareWaveCoefficients, applyDetune } from '../utils/math';
import type { OscillatorState, AdvancedSettings } from './oscillator';

const TC = 0.01; // 10ms exponential time constant for smooth UI-driven changes
/** Master fader smoothing — fast enough to feel instant, slow enough not to click. */
const MASTER_TC = 0.004;

// ─── Per-tab audio node bundle ────────────────────────────────────────────────

interface TabNodes {
  osc: OscillatorNode;
  ampGain: GainNode;      // controlled by osc.amplitude
  muteGain: GainNode;     // 0 = muted, 1 = active
  levelGain: GainNode;    // controlled by osc.masterVolume (per-tab level)
  panner: StereoPannerNode;
}

// ─── Multi-oscillator engine ──────────────────────────────────────────────────

export class MultiOscillatorEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  /**
   * Master volume, after the limiter. Before it, turning down would just let
   * the limiter release (150 ms) and claw the level back, so the change seemed
   * to fade in rather than happen.
   */
  private outputGain: GainNode | null = null;
  private tabs = new Map<string, TabNodes>();

  // ─── Context ─────────────────────────────────────────────────────────────────

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();

      // Master limiter catches the peaks that appear once several instruments,
      // drum voices and effect returns are summed. Both the speakers and the
      // recording tap sit after it, so what you hear is what you capture.
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -6;
      this.limiter.knee.value = 6;
      this.limiter.ratio.value = 12;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.15;

      this.outputGain = this.ctx.createGain();
      this.outputGain.gain.value = this.pendingVolume;

      this.masterGain.connect(this.limiter);
      this.limiter.connect(this.outputGain);
      this.outputGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  // ─── Offline rendering ───────────────────────────────────────────────────────
  //
  // Export swaps an OfflineAudioContext in place of the live one, so every
  // engine that asks for "the" context — instruments, drums, channel strips,
  // effects — builds the same graph inside it. Each of those already rebuilds
  // its nodes when it sees a different context, which is what makes the swap
  // safe in both directions.

  private saved: {
    ctx: AudioContext | null;
    master: GainNode | null;
    limiter: DynamicsCompressorNode | null;
    output: GainNode | null;
  } | null = null;
  /** Volume set before the context exists, applied when it's created. */
  private pendingVolume = 0.8;

  get isRenderingOffline(): boolean {
    return this.saved !== null;
  }

  beginOffline(ctx: OfflineAudioContext, masterVolume: number): void {
    if (this.saved) throw new Error('An offline render is already in progress');
    this.saved = {
      ctx: this.ctx, master: this.masterGain, limiter: this.limiter,
      output: this.outputGain,
    };

    // OfflineAudioContext implements every factory method the engines use;
    // the live-only APIs (resume, media streams) are never reached while rendering.
    this.ctx = ctx as unknown as AudioContext;
    this.masterGain = ctx.createGain();
    this.outputGain = ctx.createGain();
    this.outputGain.gain.value = masterVolume;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.15;
    this.masterGain.connect(this.limiter);
    this.limiter.connect(this.outputGain);
    this.outputGain.connect(ctx.destination);
  }

  endOffline(): void {
    if (!this.saved) return;
    try { this.masterGain?.disconnect(); this.limiter?.disconnect(); this.outputGain?.disconnect(); } catch { /* ignore */ }
    this.ctx = this.saved.ctx;
    this.masterGain = this.saved.master;
    this.limiter = this.saved.limiter;
    this.outputGain = this.saved.output;
    this.saved = null;
  }

  /** The node feeding the speakers (post limiter and master volume) — recording taps here. */
  getOutputNode(): AudioNode | null {
    return this.outputGain;
  }

  /** Master limiter control. Disabled = transparent (threshold at 0, ratio 1). */
  configureLimiter(enabled: boolean, thresholdDb: number): void {
    if (!this.ctx || !this.limiter) return;
    const now = this.ctx.currentTime;
    this.limiter.threshold.setTargetAtTime(enabled ? thresholdDb : 0, now, TC);
    this.limiter.ratio.setTargetAtTime(enabled ? 12 : 1, now, TC);
  }

  // ─── Tab lifecycle ────────────────────────────────────────────────────────────

  async startTab(id: string, state: OscillatorState, advanced: AdvancedSettings): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') await ctx.resume();

    this.teardownTabNodes(id);

    const master = this.masterGain!;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const ampGain = ctx.createGain();
    const muteGain = ctx.createGain();
    const levelGain = ctx.createGain();
    const panner = ctx.createStereoPanner();

    applyWaveformToNode(ctx, osc, state);
    osc.frequency.setValueAtTime(applyDetune(state.frequency, advanced.centsOffset), now);

    ampGain.gain.value = 0; // start silent, ramp in
    muteGain.gain.value = 1;
    levelGain.gain.value = state.masterVolume;
    panner.pan.value = 0;

    osc.connect(ampGain);
    ampGain.connect(muteGain);
    muteGain.connect(levelGain);
    levelGain.connect(panner);
    panner.connect(master);

    osc.start();
    ampGain.gain.setTargetAtTime(state.amplitude, now, TC);

    this.tabs.set(id, { osc, ampGain, muteGain, levelGain, panner });
  }

  stopTab(id: string): void {
    this.teardownTabNodes(id);
    this.tabs.delete(id);
  }

  removeTab(id: string): void {
    this.stopTab(id);
  }

  // ─── Live UI parameter updates ────────────────────────────────────────────────

  updateTab(id: string, state: OscillatorState, advanced: AdvancedSettings): void {
    const nodes = this.tabs.get(id);
    if (!this.ctx || !nodes) return;

    const now = this.ctx.currentTime;
    nodes.osc.frequency.setTargetAtTime(applyDetune(state.frequency, advanced.centsOffset), now, TC);
    nodes.ampGain.gain.setTargetAtTime(state.amplitude, now, TC);
    nodes.levelGain.gain.setTargetAtTime(state.masterVolume, now, TC);
    applyWaveformToNode(this.ctx, nodes.osc, state);
  }

  setTabMute(id: string, muted: boolean): void {
    const nodes = this.tabs.get(id);
    if (!this.ctx || !nodes) return;
    nodes.muteGain.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, TC);
  }

  setMasterVolume(volume: number): void {
    this.pendingVolume = volume;
    if (!this.ctx || !this.outputGain || this.saved) return;
    const g = this.outputGain.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(volume, now, MASTER_TC);
  }

  // ─── Accessors ────────────────────────────────────────────────────────────────

  getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  async getOrCreateAudioContext(): Promise<AudioContext> {
    // Previews and playback must not land in an export that's being rendered
    if (this.saved) throw new Error('Audio is busy rendering an export');
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') await ctx.resume();
    return ctx;
  }

  getMasterGain(): GainNode | null {
    return this.masterGain;
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────────

  private teardownTabNodes(id: string): void {
    const nodes = this.tabs.get(id);
    if (!nodes || !this.ctx) return;

    const { osc, ampGain, muteGain, levelGain, panner } = nodes;
    ampGain.gain.setTargetAtTime(0, this.ctx.currentTime, TC);
    setTimeout(() => {
      try { osc.stop(); } catch (_) { /* already stopped */ }
      osc.disconnect();
      ampGain.disconnect();
      muteGain.disconnect();
      levelGain.disconnect();
      panner.disconnect();
    }, 100);
  }
}

// ─── Waveform helper (exported for use by SequencerEngine) ────────────────────

/**
 * Pulse waves per context and width. Building one is 256 harmonics of maths,
 * and oscillator tracks used to do it for every note they played.
 */
const pulseWaves = new WeakMap<BaseAudioContext, Map<number, PeriodicWave>>();

function pulseWave(ctx: BaseAudioContext, width: number): PeriodicWave {
  let byWidth = pulseWaves.get(ctx);
  if (!byWidth) { byWidth = new Map(); pulseWaves.set(ctx, byWidth); }
  const key = Math.round(width * 1000) / 1000;
  let wave = byWidth.get(key);
  if (!wave) {
    const [real, imag] = squareWaveCoefficients(key, 256);
    wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    byWidth.set(key, wave);
  }
  return wave;
}

export function applyWaveformToNode(
  ctx: AudioContext,
  osc: OscillatorNode,
  state: OscillatorState,
): void {
  switch (state.waveform) {
    case 'sine':      osc.type = 'sine';     break;
    case 'sawtooth':  osc.type = 'sawtooth'; break;
    case 'triangle':  osc.type = 'triangle'; break;
    case 'square': {
      osc.setPeriodicWave(pulseWave(ctx, state.pulseWidth));
      break;
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _engine: MultiOscillatorEngine | null = null;

export function getAudioEngine(): MultiOscillatorEngine {
  if (!_engine) _engine = new MultiOscillatorEngine();
  return _engine;
}
