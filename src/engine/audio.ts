import { squareWaveCoefficients, applyDetune } from '../utils/math';
import type { OscillatorState, AdvancedSettings } from './oscillator';

const TC = 0.01; // 10ms exponential time constant for smooth UI-driven changes

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
  private mediaStreamDest: MediaStreamAudioDestinationNode | null = null;
  private tabs = new Map<string, TabNodes>();

  // ─── Context ─────────────────────────────────────────────────────────────────

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.mediaStreamDest = this.ctx.createMediaStreamDestination();

      // Master limiter catches the peaks that appear once several instruments,
      // drum voices and effect returns are summed. Both the speakers and the
      // recording tap sit after it, so what you hear is what you capture.
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -6;
      this.limiter.knee.value = 6;
      this.limiter.ratio.value = 12;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.15;

      this.masterGain.connect(this.limiter);
      this.limiter.connect(this.ctx.destination);
      this.limiter.connect(this.mediaStreamDest);
    }
    return this.ctx;
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

  setTabPan(id: string, pan: number): void {
    const nodes = this.tabs.get(id);
    if (!this.ctx || !nodes) return;
    nodes.panner.pan.setTargetAtTime(pan, this.ctx.currentTime, TC);
  }

  setMasterVolume(volume: number): void {
    if (!this.ctx || !this.masterGain) return;
    this.masterGain.gain.setTargetAtTime(volume, this.ctx.currentTime, TC);
  }

  // ─── Sequencer note scheduling ────────────────────────────────────────────────
  // Called by SequencerEngine to schedule note events at precise AudioContext times.

  scheduleNoteOn(tabId: string, freq: number, gainValue: number, time: number): void {
    const nodes = this.tabs.get(tabId);
    if (!nodes) return;
    nodes.osc.frequency.cancelScheduledValues(time);
    nodes.osc.frequency.setValueAtTime(freq, time);
    nodes.ampGain.gain.cancelScheduledValues(time);
    nodes.ampGain.gain.setValueAtTime(0, time);
    nodes.ampGain.gain.linearRampToValueAtTime(gainValue, time + 0.005);
  }

  scheduleNoteOff(tabId: string, restoreFreq: number, restoreGain: number, time: number): void {
    const nodes = this.tabs.get(tabId);
    if (!nodes) return;
    nodes.ampGain.gain.cancelScheduledValues(time - 0.001);
    nodes.ampGain.gain.setValueAtTime(restoreGain, time - 0.001);
    nodes.ampGain.gain.linearRampToValueAtTime(0, time);
    nodes.osc.frequency.setValueAtTime(restoreFreq, time + 0.001);
  }

  // ─── Accessors ────────────────────────────────────────────────────────────────

  isTabPlaying(id: string): boolean {
    return this.tabs.has(id);
  }

  getMediaStreamDest(): MediaStreamAudioDestinationNode | null {
    return this.mediaStreamDest;
  }

  getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  async getOrCreateAudioContext(): Promise<AudioContext> {
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

  destroy(): void {
    for (const id of [...this.tabs.keys()]) {
      this.teardownTabNodes(id);
      this.tabs.delete(id);
    }
    void this.ctx?.close();
    this.ctx = null;
    this.masterGain = null;
    this.limiter = null;
    this.mediaStreamDest = null;
  }
}

// ─── Waveform helper (exported for use by SequencerEngine) ────────────────────

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
      const [real, imag] = squareWaveCoefficients(state.pulseWidth, 256);
      osc.setPeriodicWave(ctx.createPeriodicWave(real, imag, { disableNormalization: false }));
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
