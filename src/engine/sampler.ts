import { getAudioEngine } from './audio';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DrumVoiceType =
  | 'kick' | 'snare' | 'hihat-c' | 'hihat-o' | 'clap'
  | 'tom-lo' | 'tom-mid' | 'tom-hi' | 'crash' | 'ride'
  | 'rim' | 'cowbell' | 'shaker';

export interface DrumHitParams {
  volume: number;    // 0–1
  pan: number;       // -1 to 1
  pitch: number;     // semitones, -12 to +12
  decay: number;     // 0.2–2.0 multiplier
  tone: number;      // 0–1
  velocity: number;  // 0–127
}

// ─── Noise helper ─────────────────────────────────────────────────────────────

function makeNoise(ctx: AudioContext, durationS: number): AudioBufferSourceNode {
  const len = Math.max(1, Math.ceil(ctx.sampleRate * durationS));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

// ─── Drum synth ───────────────────────────────────────────────────────────────

export class DrumSynth {
  private output: GainNode | null = null;

  private getOutput(ctx: AudioContext): GainNode {
    if (!this.output || this.output.context !== ctx) {
      this.output = ctx.createGain();
      this.output.gain.value = 1;
      const master = getAudioEngine().getMasterGain();
      if (master) this.output.connect(master);
    }
    return this.output;
  }

  trigger(voice: DrumVoiceType, p: DrumHitParams, time: number): void {
    const ctx = getAudioEngine().getAudioContext();
    if (!ctx) return;

    const vel = Math.max(0, Math.min(127, p.velocity));
    const velGain = (vel / 127) * Math.max(0, Math.min(1, p.volume));
    if (velGain < 0.001) return;

    const out = this.getOutput(ctx);

    // Channel strip: per-hit gain + panner
    const chanGain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    chanGain.gain.value = velGain;
    panner.pan.value = Math.max(-1, Math.min(1, p.pan));
    chanGain.connect(panner);
    panner.connect(out);

    switch (voice) {
      case 'kick':    this.kick(ctx, chanGain, p, time); break;
      case 'snare':   this.snare(ctx, chanGain, p, time); break;
      case 'hihat-c': this.hihat(ctx, chanGain, p, time, false); break;
      case 'hihat-o': this.hihat(ctx, chanGain, p, time, true); break;
      case 'clap':    this.clap(ctx, chanGain, p, time); break;
      case 'tom-lo':  this.tom(ctx, chanGain, p, time, 72); break;
      case 'tom-mid': this.tom(ctx, chanGain, p, time, 110); break;
      case 'tom-hi':  this.tom(ctx, chanGain, p, time, 155); break;
      case 'crash':   this.crash(ctx, chanGain, p, time); break;
      case 'ride':    this.ride(ctx, chanGain, p, time); break;
      case 'rim':     this.rim(ctx, chanGain, p, time); break;
      case 'cowbell': this.cowbell(ctx, chanGain, p, time); break;
      case 'shaker':  this.shaker(ctx, chanGain, p, time); break;
    }
  }

  private kick(ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number): void {
    const pm = Math.pow(2, p.pitch / 12);
    const dec = Math.max(0.1, p.decay);

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130 * pm, t);
    osc.frequency.exponentialRampToValueAtTime(40 * pm, t + 0.08 * dec);
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45 * dec);
    osc.connect(g); g.connect(dest);
    osc.start(t); osc.stop(t + 0.5 * dec);

    // Click transient
    const click = ctx.createOscillator();
    const cg = ctx.createGain();
    click.type = 'sine';
    click.frequency.setValueAtTime(800 * pm, t);
    click.frequency.exponentialRampToValueAtTime(180 * pm, t + 0.012);
    cg.gain.setValueAtTime(0.6, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.018);
    click.connect(cg); cg.connect(dest);
    click.start(t); click.stop(t + 0.025);
  }

  private snare(ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number): void {
    const pm = Math.pow(2, p.pitch / 12);
    const dec = Math.max(0.1, p.decay);
    const toneHz = 800 + p.tone * 6000;

    for (const freq of [180 * pm, 290 * pm]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.35, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14 * dec);
      osc.connect(g); g.connect(dest);
      osc.start(t); osc.stop(t + 0.18 * dec);
    }

    const noise = makeNoise(ctx, 0.35 * dec + 0.05);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = toneHz;
    bp.Q.value = 0.6;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(1, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.28 * dec);
    noise.connect(bp); bp.connect(ng); ng.connect(dest);
    noise.start(t); noise.stop(t + 0.32 * dec);
  }

  private hihat(ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number, open: boolean): void {
    const dec = open ? Math.max(0.1, p.decay) * 0.7 : Math.max(0.02, p.decay) * 0.04;
    const toneHz = 5000 + p.tone * 7000;

    const noise = makeNoise(ctx, dec + 0.02);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = toneHz;
    hp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + Math.max(0.005, dec));
    noise.connect(hp); hp.connect(g); g.connect(dest);
    noise.start(t); noise.stop(t + dec + 0.01);
  }

  private clap(ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number): void {
    const dec = Math.max(0.1, p.decay);
    const toneHz = 1200 + p.tone * 3500;

    for (let i = 0; i < 3; i++) {
      const offset = i * 0.011;
      const noise = makeNoise(ctx, 0.25 * dec);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = toneHz;
      bp.Q.value = 1.5;
      const g = ctx.createGain();
      const peak = i === 2 ? 1 : 0.5;
      g.gain.setValueAtTime(peak, t + offset);
      g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.18 * dec);
      noise.connect(bp); bp.connect(g); g.connect(dest);
      noise.start(t + offset); noise.stop(t + offset + 0.22 * dec);
    }
  }

  private tom(ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number, baseHz: number): void {
    const pm = Math.pow(2, p.pitch / 12);
    const dec = Math.max(0.1, p.decay);
    const freq = baseHz * pm;

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.6, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.06 * dec);
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.38 * dec);
    osc.connect(g); g.connect(dest);
    osc.start(t); osc.stop(t + 0.42 * dec);
  }

  private crash(ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number): void {
    const dec = Math.max(0.5, p.decay) * 1.4;
    const toneHz = 4000 + p.tone * 5000;

    const noise = makeNoise(ctx, dec + 0.1);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = toneHz;
    const peak = ctx.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = toneHz * 0.5;
    peak.gain.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.85, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dec);
    noise.connect(hp); hp.connect(peak); peak.connect(g); g.connect(dest);
    noise.start(t); noise.stop(t + dec + 0.05);
  }

  private ride(ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number): void {
    const pm = Math.pow(2, p.pitch / 12);
    const dec = Math.max(0.2, p.decay) * 0.7;

    const bell = ctx.createOscillator();
    const bg = ctx.createGain();
    bell.type = 'triangle';
    bell.frequency.value = 1250 * pm;
    bg.gain.setValueAtTime(0.55, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.55 * dec);
    bell.connect(bg); bg.connect(dest);
    bell.start(t); bell.stop(t + 0.6 * dec);

    const noise = makeNoise(ctx, 0.25 * dec);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000 + p.tone * 3000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.3, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.18 * dec);
    noise.connect(hp); hp.connect(ng); ng.connect(dest);
    noise.start(t); noise.stop(t + 0.22 * dec);
  }

  private rim(ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number): void {
    const pm = Math.pow(2, p.pitch / 12);
    const dec = Math.max(0.1, p.decay);

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 440 * pm;
    g.gain.setValueAtTime(0.65, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.045 * dec);
    osc.connect(g); g.connect(dest);
    osc.start(t); osc.stop(t + 0.055 * dec);

    const noise = makeNoise(ctx, 0.04 * dec + 0.01);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3500;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.4, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.03 * dec);
    noise.connect(hp); hp.connect(ng); ng.connect(dest);
    noise.start(t); noise.stop(t + 0.04 * dec);
  }

  private cowbell(ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number): void {
    const pm = Math.pow(2, p.pitch / 12);
    const dec = Math.max(0.1, p.decay) * 0.55;

    for (const freq of [562 * pm, 845 * pm]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.45, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dec);
      osc.connect(g); g.connect(dest);
      osc.start(t); osc.stop(t + dec + 0.01);
    }
  }

  private shaker(ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number): void {
    const dec = Math.max(0.01, p.decay) * 0.055;
    const toneHz = 7000 + p.tone * 5000;

    const noise = makeNoise(ctx, dec + 0.01);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = toneHz;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + Math.max(0.005, dec));
    noise.connect(hp); hp.connect(g); g.connect(dest);
    noise.start(t); noise.stop(t + dec + 0.005);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _synth: DrumSynth | null = null;
export function getDrumSynth(): DrumSynth {
  if (!_synth) _synth = new DrumSynth();
  return _synth;
}
