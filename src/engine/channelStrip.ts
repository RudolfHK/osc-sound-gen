import { getAudioEngine } from './audio';
import { getEffectsBus } from './effects';
import type { ChannelSettings } from '../utils/music';

const TC = 0.015;

// ─── EQ band frequencies ──────────────────────────────────────────────────────

const EQ_LOW_HZ = 200;
const EQ_MID_HZ = 1200;
const EQ_HIGH_HZ = 4000;

/**
 * One track's channel strip. Instrument voices and the track's notes feed
 * `input`; everything downstream — EQ, fader, pan, sends and sidechain ducking
 * — is shared by every note on the track, so moving a fader moves the whole
 * part rather than only notes that start afterwards.
 *
 *   input → duck → eqLow → eqMid → eqHigh → gain → panner → master
 *                                                       ├→ reverb send
 *                                                       ├→ delay send
 *                                                       └→ chorus send
 */
interface Strip {
  ctx: AudioContext;
  input: GainNode;
  duck: GainNode;
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  gain: GainNode;
  panner: StereoPannerNode;
  sendReverb: GainNode;
  sendDelay: GainNode;
  sendChorus: GainNode;
  /** Duck depth from the track's settings, read when the kick fires. */
  sidechain: number;
}

export class ChannelStripRack {
  private strips = new Map<string, Strip>();
  private ctxRef: AudioContext | null = null;

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /** The strip for a track, built on first use. Null if there is no audio yet. */
  get(tabId: string): Strip | null {
    const ctx = getAudioEngine().getAudioContext();
    if (!ctx) return null;

    // A new AudioContext invalidates every node we hold
    if (this.ctxRef !== ctx) {
      this.strips.clear();
      this.ctxRef = ctx;
    }

    const existing = this.strips.get(tabId);
    if (existing) return existing;

    const master = getAudioEngine().getMasterGain();
    if (!master) return null;

    const input = ctx.createGain();
    const duck = ctx.createGain();
    const eqLow = ctx.createBiquadFilter();
    const eqMid = ctx.createBiquadFilter();
    const eqHigh = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();

    eqLow.type = 'lowshelf';
    eqLow.frequency.value = EQ_LOW_HZ;
    eqLow.gain.value = 0;
    eqMid.type = 'peaking';
    eqMid.frequency.value = EQ_MID_HZ;
    eqMid.Q.value = 0.9;
    eqMid.gain.value = 0;
    eqHigh.type = 'highshelf';
    eqHigh.frequency.value = EQ_HIGH_HZ;
    eqHigh.gain.value = 0;

    input.connect(duck);
    duck.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    eqHigh.connect(gain);
    gain.connect(panner);
    panner.connect(master);

    const sendReverb = ctx.createGain();
    const sendDelay = ctx.createGain();
    const sendChorus = ctx.createGain();
    sendReverb.gain.value = 0;
    sendDelay.gain.value = 0;
    sendChorus.gain.value = 0;
    panner.connect(sendReverb);
    panner.connect(sendDelay);
    panner.connect(sendChorus);

    const buses = getEffectsBus().getSends();
    if (buses) {
      sendReverb.connect(buses.reverb);
      sendDelay.connect(buses.delay);
      sendChorus.connect(buses.chorus);
    }

    const strip: Strip = {
      ctx, input, duck, eqLow, eqMid, eqHigh, gain, panner,
      sendReverb, sendDelay, sendChorus, sidechain: 0,
    };
    this.strips.set(tabId, strip);
    return strip;
  }

  /** The node a track's voices should connect to. */
  getInput(tabId: string): GainNode | null {
    return this.get(tabId)?.input ?? null;
  }

  // ─── Settings ───────────────────────────────────────────────────────────────

  /**
   * Push settings onto the strip. `automated` names targets an automation lane
   * is currently driving; those are left alone so a fader and a lane never
   * wrestle over the same AudioParam.
   */
  apply(
    tabId: string,
    settings: ChannelSettings,
    pan: number,
    automated: Set<string> = new Set(),
  ): void {
    const s = this.get(tabId);
    if (!s) return;
    const now = s.ctx.currentTime;
    const set = (name: string, param: AudioParam, value: number) => {
      if (automated.has(name)) return;
      param.setTargetAtTime(value, now, TC);
    };

    set('volume', s.gain.gain, settings.gain);
    set('pan', s.panner.pan, Math.max(-1, Math.min(1, pan)));
    set('eqLow', s.eqLow.gain, settings.eqLow);
    set('eqMid', s.eqMid.gain, settings.eqMid);
    set('eqHigh', s.eqHigh.gain, settings.eqHigh);
    set('sendReverb', s.sendReverb.gain, settings.sendReverb);
    set('sendDelay', s.sendDelay.gain, settings.sendDelay);
    set('sendChorus', s.sendChorus.gain, settings.sendChorus);
    s.sidechain = settings.sidechain;
  }

  /** AudioParams the automation system writes to. */
  getParams(tabId: string): {
    volume: AudioParam; pan: AudioParam;
    eqLow: AudioParam; eqMid: AudioParam; eqHigh: AudioParam;
    sendReverb: AudioParam; sendDelay: AudioParam; sendChorus: AudioParam;
  } | null {
    const s = this.get(tabId);
    if (!s) return null;
    return {
      volume: s.gain.gain,
      pan: s.panner.pan,
      eqLow: s.eqLow.gain,
      eqMid: s.eqMid.gain,
      eqHigh: s.eqHigh.gain,
      sendReverb: s.sendReverb.gain,
      sendDelay: s.sendDelay.gain,
      sendChorus: s.sendChorus.gain,
    };
  }

  // ─── Sidechain ──────────────────────────────────────────────────────────────

  /**
   * Duck every track that has sidechain enabled. Called when the drum machine
   * schedules a kick, which is what produces the pumping that holds four-to-the-floor
   * electronic music together: the bass and pads breathe around the kick instead
   * of fighting it.
   */
  duckAll(time: number, attackS = 0.004, holdS = 0.03, releaseS = 0.22): void {
    for (const s of this.strips.values()) {
      if (s.sidechain < 0.01) continue;
      const floor = Math.max(0.0001, 1 - s.sidechain);
      const g = s.duck.gain;
      g.cancelScheduledValues(time);
      g.setValueAtTime(1, time);
      g.linearRampToValueAtTime(floor, time + attackS);
      g.setValueAtTime(floor, time + attackS + holdS);
      g.linearRampToValueAtTime(1, time + attackS + holdS + releaseS);
    }
  }

  /** Any track currently asking to be ducked? Lets the drum engine skip the work. */
  anySidechained(): boolean {
    for (const s of this.strips.values()) if (s.sidechain >= 0.01) return true;
    return false;
  }

  // ─── Teardown ───────────────────────────────────────────────────────────────

  release(tabId: string): void {
    const s = this.strips.get(tabId);
    if (!s) return;
    for (const n of [s.input, s.duck, s.eqLow, s.eqMid, s.eqHigh, s.gain, s.panner,
                     s.sendReverb, s.sendDelay, s.sendChorus]) {
      try { n.disconnect(); } catch (_) { /* already gone */ }
    }
    this.strips.delete(tabId);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _rack: ChannelStripRack | null = null;

export function getChannelRack(): ChannelStripRack {
  if (!_rack) _rack = new ChannelStripRack();
  return _rack;
}
