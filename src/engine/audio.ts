import { squareWaveCoefficients, applyDetune } from '../utils/math';
import type { OscillatorState, AdvancedSettings } from './oscillator';

const TRANSITION_TIME = 0.01; // 10ms smooth transitions

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private gainNode: GainNode | null = null;       // amplitude
  private masterGain: GainNode | null = null;     // master volume
  private currentState: OscillatorState | null = null;
  private currentAdvanced: AdvancedSettings | null = null;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    return this.ctx;
  }

  async play(state: OscillatorState, advanced: AdvancedSettings): Promise<void> {
    const ctx = this.ensureContext();

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    // Tear down any existing oscillator cleanly
    this.stopOscillator();

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = state.masterVolume;
    this.masterGain.connect(ctx.destination);

    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = 0; // ramp in
    this.gainNode.connect(this.masterGain);

    this.oscillator = ctx.createOscillator();
    this.applyWaveform(this.oscillator, state);
    const effectiveFreq = applyDetune(state.frequency, advanced.centsOffset);
    this.oscillator.frequency.setValueAtTime(effectiveFreq, ctx.currentTime);
    this.oscillator.connect(this.gainNode);
    this.oscillator.start();

    // Smooth fade-in to prevent click on start
    this.gainNode.gain.setTargetAtTime(state.amplitude, ctx.currentTime, TRANSITION_TIME);

    this.currentState = { ...state };
    this.currentAdvanced = { ...advanced };
  }

  stop(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;

    if (this.gainNode) {
      // Smooth fade-out before stopping
      this.gainNode.gain.setTargetAtTime(0, ctx.currentTime, TRANSITION_TIME);
      const osc = this.oscillator;
      const gain = this.gainNode;
      const master = this.masterGain;
      setTimeout(() => {
        try { osc?.stop(); } catch (_) { /* already stopped */ }
        osc?.disconnect();
        gain?.disconnect();
        master?.disconnect();
      }, 100);
    }

    this.oscillator = null;
    this.gainNode = null;
    this.masterGain = null;
    this.currentState = null;
  }

  updateParams(state: OscillatorState, advanced: AdvancedSettings): void {
    if (!this.ctx || !this.oscillator || !this.gainNode || !this.masterGain) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const prev = this.currentState;
    const prevAdv = this.currentAdvanced;

    // Frequency change (includes cents offset)
    const effectiveFreq = applyDetune(state.frequency, advanced.centsOffset);
    const prevEffectiveFreq = prev
      ? applyDetune(prev.frequency, prevAdv?.centsOffset ?? 0)
      : effectiveFreq;

    if (effectiveFreq !== prevEffectiveFreq) {
      this.oscillator.frequency.setTargetAtTime(effectiveFreq, now, TRANSITION_TIME);
    }

    // Amplitude change
    if (state.amplitude !== prev?.amplitude) {
      this.gainNode.gain.setTargetAtTime(state.amplitude, now, TRANSITION_TIME);
    }

    // Master volume change
    if (state.masterVolume !== prev?.masterVolume) {
      this.masterGain.gain.setTargetAtTime(state.masterVolume, now, TRANSITION_TIME);
    }

    // Waveform or pulse width change — must rebuild PeriodicWave or switch type
    const waveformChanged = state.waveform !== prev?.waveform;
    const pwChanged = state.waveform === 'square' && state.pulseWidth !== prev?.pulseWidth;
    if (waveformChanged || pwChanged) {
      this.applyWaveform(this.oscillator, state);
    }

    this.currentState = { ...state };
    this.currentAdvanced = { ...advanced };
  }

  get isRunning(): boolean {
    return this.oscillator !== null;
  }

  get contextState(): AudioContextState | 'closed' {
    return this.ctx?.state ?? 'closed';
  }

  private stopOscillator(): void {
    try { this.oscillator?.stop(); } catch (_) { /* already stopped */ }
    this.oscillator?.disconnect();
    this.gainNode?.disconnect();
    this.masterGain?.disconnect();
    this.oscillator = null;
    this.gainNode = null;
    this.masterGain = null;
  }

  private applyWaveform(osc: OscillatorNode, state: OscillatorState): void {
    const ctx = this.ensureContext();
    switch (state.waveform) {
      case 'sine':
        osc.type = 'sine';
        break;
      case 'sawtooth':
        osc.type = 'sawtooth';
        break;
      case 'triangle':
        osc.type = 'triangle';
        break;
      case 'square': {
        const [real, imag] = squareWaveCoefficients(state.pulseWidth, 256);
        const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
        osc.setPeriodicWave(wave);
        break;
      }
    }
  }

  destroy(): void {
    this.stop();
    this.ctx?.close();
    this.ctx = null;
  }
}

// Singleton instance
let _engine: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
  if (!_engine) _engine = new AudioEngine();
  return _engine;
}
