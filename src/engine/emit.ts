/**
 * Turns timeline events into sound. Shared by the live scheduler and the
 * offline exporter, so an export is made by exactly the code that plays back.
 */

import { getAudioEngine } from './audio';
import { getInstrumentEngine } from './instruments';
import { getChannelRack } from './channelStrip';
import { getDrumSynth } from './sampler';
import type { NoteEvent, TimelineEvent } from './timeline';
import type { OscillatorTab } from './oscillator';

/**
 * Schedule one event at context time `at`.
 */
export function emitEvent(
  e: TimelineEvent,
  at: number,
  ctx: BaseAudioContext,
  bpm: number,
  tabs: Map<string, OscillatorTab>,
): void {
  if (e.kind === 'click') {
    emitClick(ctx, at, e.accent);
    return;
  }

  const track = e.track;
  const route = getChannelRack().getRoute(track.id) ?? undefined;
  const bps = bpm / 60;

  if (e.kind === 'drum') {
    // The drum synth ducks sidechained tracks itself when it plays a kick
    const time = at + e.swingBeats / bps;
    getDrumSynth().trigger(e.voice.id, {
      volume: e.voice.volume,
      pan: e.voice.pan,
      pitch: e.voice.pitch + e.step.pitch,
      decay: e.voice.decay * e.step.decay,
      tone: e.voice.tone,
      velocity: e.step.velocity,
    }, time, route);
    return;
  }

  const durationS = e.durationBeats / bps;
  const noteCtx = { trackId: track.id, lanes: track.lanes, startBeat: e.songBeat, bpm, patch: track.patch };

  if (track.source.type === 'preset') {
    getInstrumentEngine().playNote(track.source.presetId, e.midiNote, e.velocity, at, durationS, noteCtx);
  } else if (track.source.type === 'oscillator') {
    const tab = tabs.get(track.source.tabId);
    if (tab) {
      getInstrumentEngine().playOscillatorNote(tab.oscillator, tab.advanced, e.midiNote, e.velocity, at, durationS, noteCtx);
    }
  }
}

/** Metronome blip — straight to the master, bypassing every track. */
function emitClick(ctx: BaseAudioContext, time: number, accent: boolean): void {
  const master = getAudioEngine().getMasterGain();
  if (!master) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = accent ? 1760 : 1175;
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(accent ? 0.35 : 0.22, time + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
  osc.connect(g);
  g.connect(master);
  osc.start(time);
  osc.stop(time + 0.06);
  osc.onended = () => { osc.disconnect(); g.disconnect(); };
}

/**
 * Whether a held note picked up partway through (note chase) is still worth
 * restarting. Sustaining sounds are; a piano or pluck that has mostly decayed
 * would come back as a fresh attack, which is worse than silence.
 */
export function worthChasing(e: NoteEvent, intoSeconds: number): boolean {
  const src = e.track.source;
  if (src.type !== 'preset') return true;
  const p = getInstrumentEngine().resolve(src.presetId, e.track.patch);
  if (!p) return false;
  if (p.amp.sustain >= 0.25) return true;
  return intoSeconds < p.amp.attack + p.amp.decay * 0.35;
}
