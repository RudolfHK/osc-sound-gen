import { getAudioEngine } from './audio';

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface EffectsSettings {
  reverbEnabled: boolean;
  reverbSize: number;      // 0.2–8 seconds of tail
  reverbDamp: number;      // 0–1, high-frequency absorption
  reverbMix: number;       // 0–1 return level

  delayEnabled: boolean;
  delayTimeMs: number;     // 20–1200
  delayFeedback: number;   // 0–0.9
  delayMix: number;        // 0–1
  delayPingPong: boolean;
  delaySync: boolean;      // derive time from the sequencer BPM
  delayDivision: DelayDivision;

  chorusEnabled: boolean;
  chorusRate: number;      // 0.05–8 Hz
  chorusDepth: number;     // 0–1
  chorusMix: number;       // 0–1

  limiterEnabled: boolean;
  limiterThreshold: number; // -40–0 dB

  drumReverbSend: number;
  drumDelaySend: number;
}

export type DelayDivision = '1/4' | '1/8' | '1/8.' | '1/8T' | '1/16' | '1/16.';

/** Each division expressed in beats (quarter note = 1 beat). */
export const DELAY_DIVISION_BEATS: Record<DelayDivision, number> = {
  '1/4': 1,
  '1/8.': 0.75,
  '1/8': 0.5,
  '1/8T': 1 / 3,
  '1/16.': 0.375,
  '1/16': 0.25,
};

export const DELAY_DIVISIONS: DelayDivision[] = ['1/4', '1/8.', '1/8', '1/8T', '1/16.', '1/16'];

export const DEFAULT_EFFECTS: EffectsSettings = {
  reverbEnabled: true,
  reverbSize: 2.2,
  reverbDamp: 0.5,
  reverbMix: 0.85,

  delayEnabled: true,
  delayTimeMs: 300,
  delayFeedback: 0.35,
  delayMix: 0.8,
  delayPingPong: true,
  delaySync: true,
  delayDivision: '1/8',

  chorusEnabled: true,
  chorusRate: 0.8,
  chorusDepth: 0.4,
  chorusMix: 0.8,

  limiterEnabled: true,
  limiterThreshold: -6,

  drumReverbSend: 0.12,
  drumDelaySend: 0.05,
};

// ─── Impulse response generation ──────────────────────────────────────────────

/**
 * Build a stereo impulse response: decorrelated noise under an exponential decay
 * curve, low-passed progressively so high frequencies die away first (the way
 * air and soft surfaces absorb them in a real room).
 */
function buildImpulse(ctx: BaseAudioContext, seconds: number, damp: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = ctx.createBuffer(2, len, rate);

  // Higher damp → faster high-frequency rolloff
  const lpCoeff = 1 - Math.pow(damp, 0.4) * 0.92;

  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // Exponential decay, slightly steeper toward the tail
      const envelope = Math.pow(1 - t, 2 + damp * 3);
      const white = Math.random() * 2 - 1;
      // One-pole low-pass gives the tail its progressive darkening
      last = last + lpCoeff * (white - last);
      data[i] = last * envelope;
    }
  }

  // A short pre-delay gap keeps the direct signal readable
  const gap = Math.floor(rate * 0.012);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < gap && i < len; i++) data[i] *= i / gap;
  }

  return buf;
}

// ─── Effects bus ──────────────────────────────────────────────────────────────

interface BusNodes {
  ctx: AudioContext;
  reverbIn: GainNode;
  delayIn: GainNode;
  chorusIn: GainNode;

  convolver: ConvolverNode;
  reverbReturn: GainNode;

  delayL: DelayNode;
  delayR: DelayNode;
  feedbackL: GainNode;
  feedbackR: GainNode;
  delayReturn: GainNode;

  chorusVoices: { delay: DelayNode; lfo: OscillatorNode; lfoGain: GainNode; panner: StereoPannerNode }[];
  chorusReturn: GainNode;
}

/**
 * A master send-effects rack. Instrument voices and drum hits connect their dry
 * signal straight to the master gain and tap the sends here, so effect levels are
 * per-sound while the processing cost is paid once.
 */
export class EffectsBus {
  private nodes: BusNodes | null = null;
  private settings: EffectsSettings = { ...DEFAULT_EFFECTS };
  private irSize = -1;
  private irDamp = -1;
  private bpm = 120;

  // ─── Construction ───────────────────────────────────────────────────────────

  private build(ctx: AudioContext): BusNodes {
    const master = getAudioEngine().getMasterGain();

    const reverbIn = ctx.createGain();
    const delayIn = ctx.createGain();
    const chorusIn = ctx.createGain();
    reverbIn.gain.value = 1;
    delayIn.gain.value = 1;
    chorusIn.gain.value = 1;

    // ── Reverb ──
    const convolver = ctx.createConvolver();
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = this.settings.reverbEnabled ? this.settings.reverbMix : 0;
    reverbIn.connect(convolver);
    convolver.connect(reverbReturn);
    if (master) reverbReturn.connect(master);

    // ── Ping-pong delay ──
    // Left taps the input, right takes left's output; each feeds back into the
    // other, so repeats alternate across the stereo field.
    const delayL = ctx.createDelay(2);
    const delayR = ctx.createDelay(2);
    const feedbackL = ctx.createGain();
    const feedbackR = ctx.createGain();
    const panL = ctx.createStereoPanner();
    const panR = ctx.createStereoPanner();
    const delayReturn = ctx.createGain();
    // Tame the repeats so they sit behind the dry signal instead of piling up
    const damper = ctx.createBiquadFilter();
    damper.type = 'lowpass';
    damper.frequency.value = 4200;

    panL.pan.value = -0.7;
    panR.pan.value = 0.7;
    delayReturn.gain.value = this.settings.delayEnabled ? this.settings.delayMix : 0;

    delayIn.connect(delayL);
    delayL.connect(damper);
    damper.connect(delayR);
    delayL.connect(feedbackL);
    delayR.connect(feedbackR);
    feedbackL.connect(delayR);
    feedbackR.connect(delayL);
    delayL.connect(panL);
    delayR.connect(panR);
    panL.connect(delayReturn);
    panR.connect(delayReturn);
    if (master) delayReturn.connect(master);

    // ── Chorus ──
    // Two short modulated delay lines panned hard apart create the width.
    const chorusReturn = ctx.createGain();
    chorusReturn.gain.value = this.settings.chorusEnabled ? this.settings.chorusMix : 0;
    const chorusVoices: BusNodes['chorusVoices'] = [];
    for (let i = 0; i < 2; i++) {
      const delay = ctx.createDelay(0.1);
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const panner = ctx.createStereoPanner();

      delay.delayTime.value = 0.018 + i * 0.009;
      lfo.type = 'sine';
      lfo.frequency.value = this.settings.chorusRate * (i === 0 ? 1 : 1.31);
      // Opposite phase per voice so the two sides drift apart, not together
      lfoGain.gain.value = this.settings.chorusDepth * 0.005 * (i === 0 ? 1 : -1);
      panner.pan.value = i === 0 ? -0.8 : 0.8;

      lfo.connect(lfoGain);
      lfoGain.connect(delay.delayTime);
      chorusIn.connect(delay);
      delay.connect(panner);
      panner.connect(chorusReturn);
      lfo.start();

      chorusVoices.push({ delay, lfo, lfoGain, panner });
    }
    if (master) chorusReturn.connect(master);

    const nodes: BusNodes = {
      ctx, reverbIn, delayIn, chorusIn,
      convolver, reverbReturn,
      delayL, delayR, feedbackL, feedbackR, delayReturn,
      chorusVoices, chorusReturn,
    };

    this.irSize = -1; // force IR render
    this.applyTo(nodes, this.settings);
    return nodes;
  }

  private ensure(): BusNodes | null {
    const ctx = getAudioEngine().getAudioContext();
    if (!ctx) return null;
    if (!this.nodes || this.nodes.ctx !== ctx) {
      this.nodes = this.build(ctx);
    }
    return this.nodes;
  }

  // ─── Parameter updates ──────────────────────────────────────────────────────

  private applyTo(n: BusNodes, s: EffectsSettings): void {
    const ctx = n.ctx;
    const now = ctx.currentTime;
    const TC = 0.02;

    // Reverb — only re-render the impulse when its shape actually changed
    if (s.reverbSize !== this.irSize || s.reverbDamp !== this.irDamp) {
      n.convolver.buffer = buildImpulse(ctx, s.reverbSize, s.reverbDamp);
      this.irSize = s.reverbSize;
      this.irDamp = s.reverbDamp;
    }
    n.reverbReturn.gain.setTargetAtTime(s.reverbEnabled ? s.reverbMix : 0, now, TC);

    // Delay
    const timeS = s.delaySync
      ? DELAY_DIVISION_BEATS[s.delayDivision] * (60 / this.bpm)
      : s.delayTimeMs / 1000;
    const clamped = Math.max(0.02, Math.min(2, timeS));
    n.delayL.delayTime.setTargetAtTime(clamped, now, TC);
    n.delayR.delayTime.setTargetAtTime(clamped, now, TC);
    const fb = s.delayPingPong ? s.delayFeedback : s.delayFeedback * 0.6;
    n.feedbackL.gain.setTargetAtTime(fb, now, TC);
    n.feedbackR.gain.setTargetAtTime(s.delayPingPong ? fb : 0, now, TC);
    n.delayReturn.gain.setTargetAtTime(s.delayEnabled ? s.delayMix : 0, now, TC);

    // Chorus
    for (let i = 0; i < n.chorusVoices.length; i++) {
      const v = n.chorusVoices[i];
      v.lfo.frequency.setTargetAtTime(s.chorusRate * (i === 0 ? 1 : 1.31), now, TC);
      v.lfoGain.gain.setTargetAtTime(s.chorusDepth * 0.005 * (i === 0 ? 1 : -1), now, TC);
    }
    n.chorusReturn.gain.setTargetAtTime(s.chorusEnabled ? s.chorusMix : 0, now, TC);

    // Limiter lives on the main output chain
    getAudioEngine().configureLimiter(s.limiterEnabled, s.limiterThreshold);
  }

  update(settings: EffectsSettings, bpm?: number): void {
    this.settings = settings;
    if (bpm !== undefined) this.bpm = bpm;
    const n = this.ensure();
    if (n) this.applyTo(n, settings);
  }

  setBpm(bpm: number): void {
    if (bpm === this.bpm) return;
    this.bpm = bpm;
    if (this.settings.delaySync) this.update(this.settings);
  }

  getSettings(): EffectsSettings {
    return this.settings;
  }

  getDrumSends(): { reverb: number; delay: number } {
    return { reverb: this.settings.drumReverbSend, delay: this.settings.drumDelaySend };
  }

  // ─── Send inputs for voices ─────────────────────────────────────────────────

  /** Returns the send bus inputs, creating the rack on first use. */
  getSends(): { reverb: GainNode; delay: GainNode; chorus: GainNode } | null {
    const n = this.ensure();
    if (!n) return null;
    return { reverb: n.reverbIn, delay: n.delayIn, chorus: n.chorusIn };
  }

  /**
   * Connect one voice's output to the three send buses at the given levels.
   * Returns the created gain nodes so the caller can disconnect them on cleanup.
   */
  connectSends(
    source: AudioNode,
    levels: { reverb: number; delay: number; chorus: number },
  ): GainNode[] {
    const sends = this.getSends();
    if (!sends) return [];
    const ctx = getAudioEngine().getAudioContext();
    if (!ctx) return [];

    const made: GainNode[] = [];
    const pairs: [number, GainNode][] = [
      [levels.reverb, sends.reverb],
      [levels.delay, sends.delay],
      [levels.chorus, sends.chorus],
    ];
    for (const [level, target] of pairs) {
      if (level < 0.005) continue;
      const g = ctx.createGain();
      g.gain.value = level;
      source.connect(g);
      g.connect(target);
      made.push(g);
    }
    return made;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _bus: EffectsBus | null = null;

export function getEffectsBus(): EffectsBus {
  if (!_bus) _bus = new EffectsBus();
  return _bus;
}
