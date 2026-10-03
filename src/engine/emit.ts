/**
 * Turns timeline events into sound. Shared by the live scheduler and the
 * offline exporter, so an export is made by exactly the code that plays back.
 */

import { getAudioEngine } from './audio';
import { getInstrumentEngine } from './instruments';
import { getChannelRack } from './channelStrip';
import { getDrumSynth } from './sampler';
import type { TimelineEvent } from './timeline';
import type { OscillatorTab } from './oscillator';

/** Drum voices that trigger sidechain ducking. */
const KICKS = new Set(['kick', 'kick-808', 'kick-tight']);

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
  const stripInput = getChannelRack().getInput(track.id) ?? undefined;
  const bps = bpm / 60;

  if (e.kind === 'drum') {
    const time = at + e.swingBeats / bps;
    if (KICKS.has(e.voice.id)) getChannelRack().duckAll(time);
    getDrumSynth().trigger(e.voice.id, {
      volume: e.voice.volume,
      pan: e.voice.pan,
      pitch: e.voice.pitch + e.step.pitch,
      decay: e.voice.decay * e.step.decay,
      tone: e.voice.tone,
      velocity: e.step.velocity,
    }, time, stripInput);
    return;
  }

  const durationS = e.durationBeats / bps;
  const noteCtx = { trackId: track.id, lanes: track.lanes, startBeat: e.songBeat, bpm };

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
