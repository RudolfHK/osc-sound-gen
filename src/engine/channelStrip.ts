import { getAudioEngine } from './audio';
import { getEffectsBus } from './effects';
import { holdAt } from './voices';
import { createWidener, type Widener } from './widener';
import type { ChannelSettings } from '../utils/music';

/**
 * Smoothing for fader, pan, EQ and send moves: 4 ms reaches the new value
 * within about 15 ms, which reads as instant while still avoiding zipper noise.
 */
const TC = 0.004;

const DEFAULT_SETTINGS: ChannelSettings = {
  gain: 1, eqLow: 0, eqMid: 0, eqHigh: 0, sendReverb: 0, sendDelay: 0, sendChorus: 0, sidechain: 0,
};

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
 *   input → width → duck → eqLow → eqMid → eqHigh → gain → panner → master
 *             │                                                ├→ reverb send
 *             │                                                ├→ delay send
 *             │                                                └→ chorus send
 *             └→ instrument sends (reverb / delay / chorus) → mute → fader → effects
 *
 * The instrument's own character lives here too, once per track rather than
 * once per note: its stereo width (voices arrive mono) and its built-in
 * effect sends (a pad's reverb). Those sends pass through the same mute and
 * fader as the dry signal, so a fader, a volume lane, mute and solo control
 * the whole sound of the track, wet and dry. One ConstantSource per control
 * drives every gain that follows it, so automation still writes one parameter.
 */
interface Strip {
  ctx: AudioContext;
  input: GainNode;
  /** Like `input` but past the instrument sends — for hits that stay dry (kicks). */
  dryInput: GainNode;
  /** Drives the fader gain and the instrument-send faders together. */
  faderCtl: ConstantSourceNode;
  /** Drives the mute gains of the dry path and the instrument sends together. */
  muteCtl: ConstantSourceNode;
  /** Where voices send their own reverb/delay/chorus — post mute and fader. */
  instSends: { reverb: GainNode; delay: GainNode; chorus: GainNode };
  /** Every node owned by the instrument-send paths, for teardown. */
  instNodes: AudioNode[];
  /** The instrument's stereo width, applied to the summed voices. */
  widener: Widener;
  /** The instrument's body resonance, when it can be applied once per track. */
  body: BiquadFilterNode;
  bodyOn: boolean;
  /** The instrument's own send levels, tapped from the widened voices. */
  presetSends: { reverb: GainNode; delay: GainNode; chorus: GainNode };
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
  /** Post-fader meter tap, made on first request. */
  analyser: AnalyserNode | null;
}

/** What the mixer last asked of a track's strip. */
/** Where a track's voices connect: the dry input and the instrument-send inputs. */
export interface StripRoute {
  input: GainNode;
  /** Skips the instrument sends: a kick that should stay out of the reverb. */
  dry: GainNode;
  sends: { reverb: GainNode; delay: GainNode; chorus: GainNode };
}

/** The sound source's part of the strip: its width and built-in effect sends. */
export interface InstrumentShape {
  width: number;
  send: { reverb: number; delay: number; chorus: number };
  /** A fixed resonance (peaking EQ) the voices leave to the strip. */
  body?: { freq: number; gain: number; q: number } | null;
}

const NO_SHAPE: InstrumentShape = { width: 0, send: { reverb: 0, delay: 0, chorus: 0 } };

interface Desired {
  settings: ChannelSettings;
  pan: number;
  automated: Set<string>;
  muted: boolean;
  shape: InstrumentShape;
}

export class ChannelStripRack {
  /**
   * Strips per audio context. An export renders into an offline context that
   * gets strips of its own; the live ones are left untouched and simply used
   * again afterwards, so nothing is rebuilt or left dangling.
   */
  private byCtx = new WeakMap<BaseAudioContext, Map<string, Strip>>();
  /** Last settings per track — a strip built later starts with them, not defaults. */
  private desired = new Map<string, Desired>();

  /** Strips of the current context. */
  private get strips(): Map<string, Strip> {
    const ctx = getAudioEngine().getAudioContext();
    if (!ctx) return new Map();
    let m = this.byCtx.get(ctx);
    if (!m) { m = new Map(); this.byCtx.set(ctx, m); }
    return m;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /** The strip for a track, built on first use. Null if there is no audio yet. */
  get(tabId: string): Strip | null {
    const ctx = getAudioEngine().getAudioContext();
    if (!ctx) return null;
    const strips = this.strips;
    const existing = strips.get(tabId);
    if (existing) return existing;

    const master = getAudioEngine().getMasterGain();
    if (!master) return null;

    const input = ctx.createGain();
    const dryInput = ctx.createGain();
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

    // Fader and mute are driven by control sources so the instrument sends can
    // follow them exactly (see the comment on Strip)
    const faderCtl = ctx.createConstantSource();
    const muteCtl = ctx.createConstantSource();
    faderCtl.offset.value = 1;
    muteCtl.offset.value = 1;
    faderCtl.start();
    muteCtl.start();
    gain.gain.value = 0;
    input.gain.value = 0;
    dryInput.gain.value = 0;
    faderCtl.connect(gain.gain);
    muteCtl.connect(input.gain);
    muteCtl.connect(dryInput.gain);

    const widener = createWidener(ctx);
    const body = ctx.createBiquadFilter();
    body.type = 'peaking';
    body.connect(widener.input);
    input.connect(widener.input);
    widener.output.connect(duck);
    dryInput.connect(duck);
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

    // Instrument sends: in → mute → fader → bus
    const instNodes: AudioNode[] = [];
    const instPath = (bus: AudioNode | undefined): GainNode => {
      const sendIn = ctx.createGain();
      const mute = ctx.createGain();
      const fader = ctx.createGain();
      mute.gain.value = 0;
      fader.gain.value = 0;
      muteCtl.connect(mute.gain);
      faderCtl.connect(fader.gain);
      sendIn.connect(mute);
      mute.connect(fader);
      if (bus) fader.connect(bus);
      instNodes.push(sendIn, mute, fader);
      return sendIn;
    };
    const instSends = {
      reverb: instPath(buses?.reverb),
      delay: instPath(buses?.delay),
      chorus: instPath(buses?.chorus),
    };
    const tap = (to: GainNode) => {
      const g = ctx.createGain();
      g.gain.value = 0;
      widener.output.connect(g);
      g.connect(to);
      instNodes.push(g);
      return g;
    };
    const presetSends = { reverb: tap(instSends.reverb), delay: tap(instSends.delay), chorus: tap(instSends.chorus) };

    const strip: Strip = {
      ctx, input, dryInput, faderCtl, muteCtl, instSends, instNodes, widener, body, bodyOn: false, presetSends, duck, eqLow, eqMid, eqHigh, gain, panner,
      sendReverb, sendDelay, sendChorus, sidechain: 0, analyser: null,
    };
    strips.set(tabId, strip);

    // Start at the track's real settings: a note auditioned before playback
    // has ever started should already go through its fader, EQ and sends.
    const d = this.desired.get(tabId);
    if (d) {
      this.write(strip, d, (param, value) => { param.value = value; });
      muteCtl.offset.value = d.muted ? 0 : 1;
      this.writeShape(strip, d.shape);
    }
    return strip;
  }

  /**
   * The track's sound source: its stereo width and its own effect sends. Voices
   * on a strip arrive mono and without sends; the strip adds both once.
   */
  setInstrument(tabId: string, shape: InstrumentShape): void {
    const d = this.desired.get(tabId);
    if (d) d.shape = shape;
    else this.desired.set(tabId, { settings: DEFAULT_SETTINGS, pan: 0, automated: new Set(), muted: false, shape });
    const s = this.get(tabId);
    if (s) this.writeShape(s, shape);
  }

  private writeShape(s: Strip, shape: InstrumentShape): void {
    s.widener.setWidth(shape.width);
    // The body filter is only in the path when the instrument has one
    const b = shape.body;
    if (b) {
      s.body.frequency.value = b.freq;
      s.body.gain.value = b.gain;
      s.body.Q.value = b.q;
    }
    if (!!b !== s.bodyOn) {
      if (b) { s.input.disconnect(s.widener.input); s.input.connect(s.body); }
      else { s.input.disconnect(s.body); s.input.connect(s.widener.input); }
      s.bodyOn = !!b;
    }
    s.presetSends.reverb.gain.value = shape.send.reverb;
    s.presetSends.delay.gain.value = shape.send.delay;
    s.presetSends.chorus.gain.value = shape.send.chorus;
  }

  /** Where a track's voices connect: dry signal and their own effect sends. */
  getRoute(tabId: string): StripRoute | null {
    const s = this.get(tabId);
    return s ? { input: s.input, dry: s.dryInput, sends: s.instSends } : null;
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
    const prev = this.desired.get(tabId);
    const d: Desired = { settings, pan, automated, muted: prev?.muted ?? false, shape: prev?.shape ?? NO_SHAPE };
    this.desired.set(tabId, d);
    const s = this.get(tabId);
    if (!s) return;
    const now = s.ctx.currentTime;
    this.write(s, d, (param, value) => param.setTargetAtTime(value, now, TC));
  }

  private write(s: Strip, d: Desired, to: (param: AudioParam, value: number) => void): void {
    const { settings, pan, automated } = d;
    const set = (name: string, param: AudioParam, value: number) => {
      if (!automated.has(name)) to(param, value);
    };

    set('volume', s.faderCtl.offset, settings.gain);
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
      volume: s.faderCtl.offset,
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

  /**
   * Transport stopped: drop automation ramps and sidechain ducks that were
   * written ahead of the playhead, so nothing keeps moving after the stop.
   * Params hold where they are; the caller reapplies the static mix.
   */
  haltAutomation(): void {
    for (const s of this.strips.values()) {
      const now = s.ctx.currentTime;
      for (const p of [s.faderCtl.offset, s.panner.pan, s.eqLow.gain, s.eqMid.gain, s.eqHigh.gain,
                       s.sendReverb.gain, s.sendDelay.gain, s.sendChorus.gain]) {
        holdAt(p, now);
      }
      s.duck.gain.cancelScheduledValues(now);
      s.duck.gain.setTargetAtTime(1, now, TC);
    }
  }

  // ─── Metering ───────────────────────────────────────────────────────────────

  /** Post-fader analyser for a track's live meter, created on first request. */
  getAnalyser(trackId: string): AnalyserNode | null {
    if (getAudioEngine().isRenderingOffline) return null; // meters are for the live mix
    const s = this.get(trackId);
    if (!s) return null;
    if (!s.analyser) {
      s.analyser = s.ctx.createAnalyser();
      s.analyser.fftSize = 512;
      s.panner.connect(s.analyser);
    }
    return s.analyser;
  }

  // ─── Mute ───────────────────────────────────────────────────────────────────

  /**
   * Mute is a gain on the strip input, not a skipped note, so it silences notes
   * that are already sounding and un-muting brings a held pad straight back.
   */
  setMute(trackId: string, muted: boolean): void {
    const d = this.desired.get(trackId);
    if (d) d.muted = muted;
    const s = this.get(trackId);
    if (!s) return;
    s.muteCtl.offset.setTargetAtTime(muted ? 0 : 1, s.ctx.currentTime, TC);
  }

  /** Release strips for tracks that no longer exist. */
  retain(trackIds: Set<string>): void {
    for (const id of [...this.strips.keys()]) {
      if (!trackIds.has(id)) this.release(id);
    }
    for (const id of [...this.desired.keys()]) {
      if (!trackIds.has(id)) this.desired.delete(id);
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
    for (const c of [s.faderCtl, s.muteCtl]) {
      try { c.stop(); } catch (_) { /* already stopped */ }
    }
    for (const n of [s.input, s.dryInput, s.body, s.faderCtl, s.muteCtl, s.duck, s.eqLow, s.eqMid, s.eqHigh, s.gain, s.panner,
                     s.sendReverb, s.sendDelay, s.sendChorus, s.analyser, ...s.instNodes]) {
      try { n?.disconnect(); } catch (_) { /* already gone */ }
    }
    s.widener.disconnect();
    this.strips.delete(tabId);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _rack: ChannelStripRack | null = null;

export function getChannelRack(): ChannelStripRack {
  if (!_rack) _rack = new ChannelStripRack();
  return _rack;
}
