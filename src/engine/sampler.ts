import { getAudioEngine } from './audio';
import { getEffectsBus } from './effects';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DrumVoiceType =
  // Core kit
  | 'kick' | 'kick-808' | 'kick-tight'
  | 'snare' | 'snare-808' | 'snare-brush'
  | 'hihat-c' | 'hihat-o' | 'hihat-pedal'
  | 'clap' | 'rim' | 'snap'
  | 'tom-lo' | 'tom-mid' | 'tom-hi'
  // Cymbals
  | 'crash' | 'ride' | 'ride-bell' | 'splash' | 'cymbal-rev'
  // Percussion
  | 'cowbell' | 'shaker' | 'tambourine' | 'cabasa'
  | 'conga-hi' | 'conga-lo' | 'bongo' | 'timbale'
  | 'woodblock' | 'clave' | 'triangle'
  // FX
  | 'zap' | 'sub-drop';

export interface DrumHitParams {
  volume: number;    // 0–1
  pan: number;       // -1 to 1
  pitch: number;     // semitones, -12 to +12
  decay: number;     // 0.2–2.0 multiplier
  tone: number;      // 0–1
  velocity: number;  // 0–127
}

// ─── Cached noise source ──────────────────────────────────────────────────────
// One 2-second buffer per AudioContext; each hit reads from a random offset.
// Avoids allocating a fresh buffer per trigger (GC pressure at high densities).

const noiseCache = new WeakMap<AudioContext, AudioBuffer>();

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 2), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  return buf;
}

/** A looping noise source; start with a random offset so repeats don't phase-lock. */
function noiseSource(ctx: AudioContext): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  return src;
}

function startNoise(src: AudioBufferSourceNode, t: number, stopAt: number): void {
  src.start(t, Math.random() * 1.5);
  src.stop(stopAt);
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

    // Per-hit channel strip: gain + panner
    const chanGain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    chanGain.gain.value = velGain;
    panner.pan.value = Math.max(-1, Math.min(1, p.pan));
    chanGain.connect(panner);
    panner.connect(out);

    // Ambience — a kit with no room around it is the giveaway that it is synthetic.
    // Cymbals and snares get the send; kicks and subs stay dry to keep the low end tight.
    const bus = getEffectsBus();
    const drumSends = bus.getDrumSends();
    const dry = voice === 'kick' || voice === 'kick-808' || voice === 'kick-tight' || voice === 'sub-drop';
    if (!dry && (drumSends.reverb > 0.005 || drumSends.delay > 0.005)) {
      bus.connectSends(panner, {
        reverb: drumSends.reverb,
        delay: drumSends.delay,
        chorus: 0,
      });
    }

    switch (voice) {
      // Kicks
      case 'kick':       this.kick(ctx, chanGain, p, time, 130, 40, 0.45, 0.6); break;
      case 'kick-808':   this.kick(ctx, chanGain, p, time, 110, 30, 1.05, 0.3); break;
      case 'kick-tight': this.kick(ctx, chanGain, p, time, 190, 55, 0.20, 0.9); break;
      // Snares
      case 'snare':       this.snare(ctx, chanGain, p, time, [180, 290], 1.0, 0.35); break;
      case 'snare-808':   this.snare(ctx, chanGain, p, time, [220, 330], 0.75, 0.55); break;
      case 'snare-brush': this.brush(ctx, chanGain, p, time); break;
      // Hats
      case 'hihat-c':     this.hihat(ctx, chanGain, p, time, 'closed'); break;
      case 'hihat-o':     this.hihat(ctx, chanGain, p, time, 'open'); break;
      case 'hihat-pedal': this.hihat(ctx, chanGain, p, time, 'pedal'); break;
      // Hand percussion
      case 'clap': this.clap(ctx, chanGain, p, time); break;
      case 'rim':  this.rim(ctx, chanGain, p, time); break;
      case 'snap': this.snap(ctx, chanGain, p, time); break;
      // Toms
      case 'tom-lo':  this.tom(ctx, chanGain, p, time, 72); break;
      case 'tom-mid': this.tom(ctx, chanGain, p, time, 110); break;
      case 'tom-hi':  this.tom(ctx, chanGain, p, time, 155); break;
      // Cymbals
      case 'crash':      this.cymbal(ctx, chanGain, p, time, 1.4, 4000, 0.85); break;
      case 'splash':     this.cymbal(ctx, chanGain, p, time, 0.55, 6500, 0.7); break;
      case 'ride':       this.ride(ctx, chanGain, p, time, false); break;
      case 'ride-bell':  this.ride(ctx, chanGain, p, time, true); break;
      case 'cymbal-rev': this.reverseCymbal(ctx, chanGain, p, time); break;
      // Latin / world percussion
      case 'cowbell':    this.cowbell(ctx, chanGain, p, time); break;
      case 'shaker':     this.grain(ctx, chanGain, p, time, 7000, 0.055, 0.55); break;
      case 'cabasa':     this.grain(ctx, chanGain, p, time, 8500, 0.085, 0.5); break;
      case 'tambourine': this.tambourine(ctx, chanGain, p, time); break;
      case 'conga-hi':   this.conga(ctx, chanGain, p, time, 260); break;
      case 'conga-lo':   this.conga(ctx, chanGain, p, time, 170); break;
      case 'bongo':      this.conga(ctx, chanGain, p, time, 385); break;
      case 'timbale':    this.timbale(ctx, chanGain, p, time); break;
      case 'woodblock':  this.woodblock(ctx, chanGain, p, time, 1150); break;
      case 'clave':      this.woodblock(ctx, chanGain, p, time, 2400); break;
      case 'triangle':   this.triangleBell(ctx, chanGain, p, time); break;
      // FX
      case 'zap':       this.zap(ctx, chanGain, p, time); break;
      case 'sub-drop':  this.subDrop(ctx, chanGain, p, time); break;
    }
  }

  // ─── Kick family ────────────────────────────────────────────────────────────

  private kick(
    ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number,
    startHz: number, endHz: number, tail: number, clickAmt: number,
  ): void {
    const pm = Math.pow(2, p.pitch / 12);
    const dec = Math.max(0.1, p.decay);

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startHz * pm, t);
    osc.frequency.exponentialRampToValueAtTime(endHz * pm, t + 0.08 * dec);
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + tail * dec);
    osc.connect(g); g.connect(dest);
    osc.start(t); osc.stop(t + tail * dec + 0.05);

    if (clickAmt > 0.01) {
      const click = ctx.createOscillator();
      const cg = ctx.createGain();
      click.type = 'sine';
      click.frequency.setValueAtTime(800 * pm, t);
      click.frequency.exponentialRampToValueAtTime(180 * pm, t + 0.012);
      cg.gain.setValueAtTime(clickAmt, t);
      cg.gain.exponentialRampToValueAtTime(0.001, t + 0.018);
      click.connect(cg); cg.connect(dest);
      click.start(t); click.stop(t + 0.025);
    }
  }

  private subDrop(ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number): void {
    const pm = Math.pow(2, p.pitch / 12);
    const dec = Math.max(0.2, p.decay) * 0.85;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(85 * pm, t);
    osc.frequency.exponentialRampToValueAtTime(24 * pm, t + dec);
    g.gain.setValueAtTime(0.9, t);
    g.gain.setValueAtTime(0.9, t + dec * 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, t + dec);
    osc.connect(g); g.connect(dest);
    osc.start(t); osc.stop(t + dec + 0.05);
  }

  // ─── Snare family ───────────────────────────────────────────────────────────

  private snare(
    ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number,
    bodyHz: number[], noiseAmt: number, bodyAmt: number,
  ): void {
    const pm = Math.pow(2, p.pitch / 12);
    const dec = Math.max(0.1, p.decay);
    const toneHz = 800 + p.tone * 6000;

    for (const freq of bodyHz) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq * pm;
      g.gain.setValueAtTime(bodyAmt, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14 * dec);
      osc.connect(g); g.connect(dest);
      osc.start(t); osc.stop(t + 0.18 * dec);
    }

    const stop = t + 0.32 * dec;
    const noise = noiseSource(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = toneHz;
    bp.Q.value = 0.6;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(noiseAmt, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.28 * dec);
    noise.connect(bp); bp.connect(ng); ng.connect(dest);
    startNoise(noise, t, stop);
  }

  /** Brush snare — slow swell through a narrow band, no tonal body. */
  private brush(ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number): void {
    const dec = Math.max(0.1, p.decay) * 1.2;
    const stop = t + 0.4 * dec;
    const noise = noiseSource(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900 + p.tone * 2500;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.55, t + 0.03 * dec);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.36 * dec);
    noise.connect(bp); bp.connect(g); g.connect(dest);
    startNoise(noise, t, stop);
  }

  // ─── Hats ───────────────────────────────────────────────────────────────────

  private hihat(
    ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number,
    mode: 'closed' | 'open' | 'pedal',
  ): void {
    const base = Math.max(0.02, p.decay);
    const dec = mode === 'open' ? base * 0.7 : mode === 'pedal' ? base * 0.055 : base * 0.04;
    const toneHz = mode === 'pedal'
      ? 3800 + p.tone * 3000
      : 5000 + p.tone * 7000;

    const stop = t + dec + 0.02;
    const noise = noiseSource(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = toneHz;
    hp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(mode === 'pedal' ? 0.6 : 0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + Math.max(0.005, dec));
    noise.connect(hp); hp.connect(g); g.connect(dest);
    startNoise(noise, t, stop);
  }

  // ─── Hand percussion ────────────────────────────────────────────────────────

  private clap(ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number): void {
    const dec = Math.max(0.1, p.decay);
    const toneHz = 1200 + p.tone * 3500;

    for (let i = 0; i < 3; i++) {
      const offset = i * 0.011;
      const stop = t + offset + 0.22 * dec;
      const noise = noiseSource(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = toneHz;
      bp.Q.value = 1.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(i === 2 ? 1 : 0.5, t + offset);
      g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.18 * dec);
      noise.connect(bp); bp.connect(g); g.connect(dest);
      startNoise(noise, t + offset, stop);
    }
  }

  private snap(ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number): void {
    const dec = Math.max(0.1, p.decay);
    const stop = t + 0.14 * dec;
    const noise = noiseSource(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2000 + p.tone * 2500;
    bp.Q.value = 3.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.11 * dec);
    noise.connect(bp); bp.connect(g); g.connect(dest);
    startNoise(noise, t, stop);

    const click = ctx.createOscillator();
    const cg = ctx.createGain();
    click.type = 'triangle';
    click.frequency.value = 1600;
    cg.gain.setValueAtTime(0.3, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    click.connect(cg); cg.connect(dest);
    click.start(t); click.stop(t + 0.03);
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

    const stop = t + 0.04 * dec;
    const noise = noiseSource(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3500;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.4, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.03 * dec);
    noise.connect(hp); hp.connect(ng); ng.connect(dest);
    startNoise(noise, t, stop);
  }

  // ─── Toms & hand drums ──────────────────────────────────────────────────────

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

  /** Congas / bongos — tighter skin than a tom, with a slap transient. */
  private conga(ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number, baseHz: number): void {
    const pm = Math.pow(2, p.pitch / 12);
    const dec = Math.max(0.1, p.decay) * 0.65;
    const freq = baseHz * pm;

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.35, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.03 * dec);
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3 * dec);
    osc.connect(g); g.connect(dest);
    osc.start(t); osc.stop(t + 0.34 * dec);

    const stop = t + 0.03;
    const noise = noiseSource(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200 + p.tone * 2000;
    bp.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.35, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
    noise.connect(bp); bp.connect(ng); ng.connect(dest);
    startNoise(noise, t, stop);
  }

  private timbale(ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number): void {
    const pm = Math.pow(2, p.pitch / 12);
    const dec = Math.max(0.1, p.decay) * 0.7;

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(340 * pm, t);
    osc.frequency.exponentialRampToValueAtTime(300 * pm, t + 0.05 * dec);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28 * dec);
    osc.connect(g); g.connect(dest);
    osc.start(t); osc.stop(t + 0.32 * dec);

    const stop = t + 0.1 * dec;
    const noise = noiseSource(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500 + p.tone * 3000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.08 * dec);
    noise.connect(hp); hp.connect(ng); ng.connect(dest);
    startNoise(noise, t, stop);
  }

  // ─── Cymbals ────────────────────────────────────────────────────────────────

  private cymbal(
    ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number,
    tailMul: number, baseHz: number, peak: number,
  ): void {
    const dec = Math.max(0.3, p.decay) * tailMul;
    const toneHz = baseHz + p.tone * 5000;
    const stop = t + dec + 0.05;

    const noise = noiseSource(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = toneHz;
    const peakF = ctx.createBiquadFilter();
    peakF.type = 'peaking';
    peakF.frequency.value = toneHz * 0.5;
    peakF.gain.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dec);
    noise.connect(hp); hp.connect(peakF); peakF.connect(g); g.connect(dest);
    startNoise(noise, t, stop);
  }

  /** Reverse cymbal swell — gain ramps up into a hard cut. */
  private reverseCymbal(ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number): void {
    const dur = Math.max(0.3, p.decay) * 0.85;
    const stop = t + dur + 0.02;
    const noise = noiseSource(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(2000, t);
    hp.frequency.linearRampToValueAtTime(6000 + p.tone * 4000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.005, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + dur);
    g.gain.linearRampToValueAtTime(0.001, t + dur + 0.015);
    noise.connect(hp); hp.connect(g); g.connect(dest);
    startNoise(noise, t, stop);
  }

  private ride(ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number, bell: boolean): void {
    const pm = Math.pow(2, p.pitch / 12);
    const dec = Math.max(0.2, p.decay) * (bell ? 1.1 : 0.7);

    const osc = ctx.createOscillator();
    const bg = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = (bell ? 1750 : 1250) * pm;
    bg.gain.setValueAtTime(bell ? 0.75 : 0.55, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.55 * dec);
    osc.connect(bg); bg.connect(dest);
    osc.start(t); osc.stop(t + 0.6 * dec);

    const stop = t + 0.22 * dec;
    const noise = noiseSource(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000 + p.tone * 3000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(bell ? 0.18 : 0.3, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.18 * dec);
    noise.connect(hp); hp.connect(ng); ng.connect(dest);
    startNoise(noise, t, stop);
  }

  // ─── Shakers & metallic percussion ──────────────────────────────────────────

  /** Generic filtered-noise grain — shaker, cabasa. */
  private grain(
    ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number,
    baseHz: number, tail: number, peak: number,
  ): void {
    const dec = Math.max(0.01, p.decay) * tail;
    const stop = t + dec + 0.01;
    const noise = noiseSource(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = baseHz + p.tone * 5000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + Math.max(0.005, dec));
    noise.connect(hp); hp.connect(g); g.connect(dest);
    startNoise(noise, t, stop);
  }

  private tambourine(ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number): void {
    const dec = Math.max(0.1, p.decay) * 0.4;
    // Three jingle layers at slightly offset times
    for (let i = 0; i < 3; i++) {
      const off = i * 0.004;
      const stop = t + off + dec + 0.01;
      const noise = noiseSource(ctx);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 6000 + i * 1200 + p.tone * 3000;
      const bp = ctx.createBiquadFilter();
      bp.type = 'peaking';
      bp.frequency.value = 9000 + i * 900;
      bp.gain.value = 8;
      bp.Q.value = 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.45, t + off);
      g.gain.exponentialRampToValueAtTime(0.001, t + off + dec);
      noise.connect(hp); hp.connect(bp); bp.connect(g); g.connect(dest);
      startNoise(noise, t + off, stop);
    }
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

  private woodblock(ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number, baseHz: number): void {
    const pm = Math.pow(2, p.pitch / 12);
    const dec = Math.max(0.1, p.decay) * 0.07;

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseHz * pm * 1.15, t);
    osc.frequency.exponentialRampToValueAtTime(baseHz * pm, t + 0.008);
    g.gain.setValueAtTime(0.95, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dec);
    osc.connect(g); g.connect(dest);
    osc.start(t); osc.stop(t + dec + 0.01);

    const stop = t + 0.012;
    const noise = noiseSource(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = baseHz * 2.2;
    bp.Q.value = 2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.3, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.01);
    noise.connect(bp); bp.connect(ng); ng.connect(dest);
    startNoise(noise, t, stop);
  }

  private triangleBell(ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number): void {
    const pm = Math.pow(2, p.pitch / 12);
    const dec = Math.max(0.2, p.decay) * 1.6;

    // Inharmonic partials give the shimmer
    for (const [freq, amt] of [[4200, 0.4], [5300, 0.3], [6900, 0.22]] as [number, number][]) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * pm;
      g.gain.setValueAtTime(amt, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dec);
      osc.connect(g); g.connect(dest);
      osc.start(t); osc.stop(t + dec + 0.02);
    }
  }

  // ─── FX ─────────────────────────────────────────────────────────────────────

  private zap(ctx: AudioContext, dest: GainNode, p: DrumHitParams, t: number): void {
    const pm = Math.pow(2, p.pitch / 12);
    const dec = Math.max(0.05, p.decay) * 0.22;

    const osc = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(2400 * pm, t);
    osc.frequency.exponentialRampToValueAtTime(90 * pm, t + dec);
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(6000, t);
    lp.frequency.exponentialRampToValueAtTime(400, t + dec);
    lp.Q.value = 6 + p.tone * 10;
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dec);
    osc.connect(lp); lp.connect(g); g.connect(dest);
    osc.start(t); osc.stop(t + dec + 0.02);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _synth: DrumSynth | null = null;
export function getDrumSynth(): DrumSynth {
  if (!_synth) _synth = new DrumSynth();
  return _synth;
}

// ─── Shared noise helper for other engines (instruments.ts) ───────────────────

export { noiseSource, startNoise };
