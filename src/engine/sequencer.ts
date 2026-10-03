import { getAudioEngine, applyWaveformToNode } from './audio';
import { getInstrumentEngine } from './instruments';
import { getChannelRack } from './channelStrip';
import { expandArpCached } from './arpeggiator';
import { AUTOMATION_TARGETS, CHANNEL_TARGETS, laneValueAt } from './automation';
import { midiToFreq, beatsToSeconds, SNAP_BEATS, makeDefaultArp, makeDefaultChannel } from '../utils/music';
import type { SequencerState, SequencerTrack, SnapValue, SequencerNote } from '../utils/music';
import type { OscillatorState, OscillatorTab } from './oscillator';

const SCHEDULE_AHEAD_S = 0.12; // schedule 120ms ahead
const SCHEDULER_MS = 25;       // run scheduler every 25ms
/** Channel automation is written in chunks this many beats long. */
const AUTOMATION_CHUNK_BEATS = 0.25;

// ─── Per-track audio nodes owned by the sequencer (separate from UI tabs) ────

interface SeqNodes {
  osc: OscillatorNode;
  gain: GainNode;
  panner: StereoPannerNode;
}

// ─── Sequencer engine ─────────────────────────────────────────────────────────

export class SequencerEngine {
  private isPlaying = false;
  private bpm = 120;
  private loopEnabled = false;
  private loopStartBeat = 0;
  private loopEndBeat = 16;

  private startAudioTime = 0;  // AudioContext.currentTime when play was pressed
  private startBeat = 0;       // beat position at which play started
  private scheduleUpToBeat = 0; // how far ahead we've scheduled

  // "noteId:loopRep" → already scheduled
  private scheduledKeys = new Set<string>();

  private tracks: SequencerTrack[] = [];
  /** Tracks paired with their arpeggiator-expanded note lists. */
  private expandedTracks: { track: SequencerTrack; notes: SequencerNote[] }[] = [];
  /** How far ahead channel automation has been written, per track. */
  private chanSchedBeat = new Map<string, number>();
  private tabMap = new Map<string, OscillatorTab>(); // tabId → tab

  // Own audio nodes (separate from MultiOscillatorEngine's UI nodes)
  private seqNodes = new Map<string, SeqNodes>();

  private schedulerTimer: ReturnType<typeof setTimeout> | null = null;
  private rafId = 0;

  private onPlayheadUpdate: ((beat: number) => void) | null = null;

  // ─── Control API ─────────────────────────────────────────────────────────────

  configure(state: SequencerState, tabs: OscillatorTab[]): void {
    this.bpm = state.bpm;
    this.loopEnabled = state.loopEnabled;
    this.loopStartBeat = state.loopStartBeat;
    this.loopEndBeat = state.loopEndBeat;
    this.tracks = state.tracks;
    this.tabMap.clear();
    for (const t of tabs) this.tabMap.set(t.id, t);

    // Run each track's notes through its arpeggiator once, here, rather than
    // inside the scheduler where it would repeat every 25 ms.
    this.expandedTracks = state.tracks.map((track) => ({
      track,
      notes: expandArpCached(track.tabId, track.notes, track.arp ?? makeDefaultArp()),
    }));

    // Push channel settings, skipping anything an active lane is driving so the
    // two don't fight over the same AudioParam.
    const rack = getChannelRack();
    for (const track of state.tracks) {
      const automated = new Set(
        (track.lanes ?? [])
          .filter((l) => l.enabled && l.points.length > 0)
          .map((l) => l.target as string),
      );
      rack.apply(track.tabId, track.channel ?? makeDefaultChannel(), track.pan, automated);
    }
  }

  async play(
    startBeat: number,
    state: SequencerState,
    tabs: OscillatorTab[],
    onPlayheadUpdate: (beat: number) => void,
  ): Promise<void> {
    const audioEngine = getAudioEngine();
    const ctx = await audioEngine.getOrCreateAudioContext();

    this.configure(state, tabs);
    this.onPlayheadUpdate = onPlayheadUpdate;
    this.isPlaying = true;
    this.startBeat = startBeat;
    this.startAudioTime = ctx.currentTime + 0.05; // 50ms latency buffer
    this.scheduleUpToBeat = startBeat;
    this.scheduledKeys.clear();
    this.chanSchedBeat.clear();

    // Create own oscillator nodes per track
    this.teardownSeqNodes();
    this.buildSeqNodes(ctx, tabs, state);

    // Start scheduler and playhead RAF
    this.schedulerLoop();
    this.rafLoop(ctx);
  }

  stop(): void {
    this.isPlaying = false;
    if (this.schedulerTimer !== null) {
      clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    cancelAnimationFrame(this.rafId);
    this.teardownSeqNodes();
  }

  updateState(state: SequencerState, tabs: OscillatorTab[]): void {
    // configure() already pushes pan and the rest of the channel settings onto
    // each strip, which is where panning now lives.
    this.configure(state, tabs);
  }

  get running(): boolean {
    return this.isPlaying;
  }

  // ─── Scheduler ────────────────────────────────────────────────────────────────

  private schedulerLoop(): void {
    if (!this.isPlaying) return;

    const ctx = getAudioEngine().getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const bps = this.bpm / 60;
    const lookaheadBeats = SCHEDULE_AHEAD_S * bps;

    // Current song position in beats (monotonically increasing, no loop wrapping)
    const currentMonotonicBeat = this.startBeat + (now - this.startAudioTime) * bps;
    const scheduleToMonotonic = currentMonotonicBeat + lookaheadBeats;

    for (const { track, notes } of this.expandedTracks) {
      const nodes = this.seqNodes.get(track.tabId);
      const tab = this.tabMap.get(track.tabId);
      if (!tab) continue;
      // A track either plays through an assigned instrument preset or its own
      // oscillator node — one of the two must be available.
      const presetId = getInstrumentEngine().getTrackInstrument(track.tabId);
      if (!nodes && !presetId) continue;

      const restoreFreq = tab.oscillator.frequency;
      const restoreGain = tab.oscillator.amplitude * tab.oscillator.masterVolume;

      for (const note of notes) {
        if (this.loopEnabled) {
          const loopLen = this.loopEndBeat - this.loopStartBeat;
          if (loopLen <= 0) continue;
          const relPos = note.startBeat - this.loopStartBeat;
          if (relPos < 0 || relPos >= loopLen) continue;

          // Determine which loop repetitions fall in our scheduling window
          const firstRep = Math.floor(
            (this.scheduleUpToBeat - this.loopStartBeat) / loopLen,
          );
          for (let rep = Math.max(0, firstRep - 1); rep <= firstRep + 2; rep++) {
            const monotonicStart = this.loopStartBeat + loopLen * rep + relPos;
            const key = `${note.id}:${rep}`;

            if (
              monotonicStart >= this.scheduleUpToBeat &&
              monotonicStart < scheduleToMonotonic &&
              !this.scheduledKeys.has(key)
            ) {
              const noteOnTime = this.startAudioTime + (monotonicStart - this.startBeat) / bps;
              const noteOffTime = noteOnTime + beatsToSeconds(note.durationBeats, this.bpm);

              this.emitNote(presetId, track, nodes, note, tab.oscillator,
                noteOnTime, noteOffTime, restoreFreq, restoreGain, monotonicStart);
              this.scheduledKeys.add(key);
            }
          }
        } else {
          const key = note.id;
          if (
            note.startBeat >= this.scheduleUpToBeat &&
            note.startBeat < scheduleToMonotonic &&
            !this.scheduledKeys.has(key)
          ) {
            const noteOnTime = this.startAudioTime + (note.startBeat - this.startBeat) / bps;
            const noteOffTime = noteOnTime + beatsToSeconds(note.durationBeats, this.bpm);

            this.emitNote(presetId, track, nodes, note, tab.oscillator,
              noteOnTime, noteOffTime, restoreFreq, restoreGain, note.startBeat);
            this.scheduledKeys.add(key);
          }
        }
      }
    }

    this.scheduleChannelAutomation(scheduleToMonotonic, bps);

    this.scheduleUpToBeat = scheduleToMonotonic;
    this.schedulerTimer = setTimeout(() => this.schedulerLoop(), SCHEDULER_MS);
  }

  /**
   * Write channel-strip automation (volume, pan, EQ, sends) ahead of the
   * playhead in short chunks.
   *
   * Unlike note parameters these live on long-lived nodes, so each chunk ramps
   * toward the lane's value at the chunk's end instead of being rewritten from
   * scratch every tick.
   */
  private scheduleChannelAutomation(scheduleToMonotonic: number, bps: number): void {
    const ctx = getAudioEngine().getAudioContext();
    if (!ctx) return;
    const rack = getChannelRack();

    for (const track of this.tracks) {
      const lanes = (track.lanes ?? []).filter(
        (l) => l.enabled && l.points.length > 0 && CHANNEL_TARGETS.includes(l.target),
      );
      if (lanes.length === 0) continue;

      const params = rack.getParams(track.tabId);
      if (!params) continue;

      let upTo = this.chanSchedBeat.get(track.tabId) ?? this.startBeat;
      // Guard against a huge catch-up if the tab was backgrounded
      if (scheduleToMonotonic - upTo > 8) upTo = scheduleToMonotonic - 1;

      while (upTo < scheduleToMonotonic) {
        const chunkEnd = upTo + AUTOMATION_CHUNK_BEATS;
        const atTime = this.startAudioTime + (chunkEnd - this.startBeat) / bps;
        // Lanes follow the looped position, so automation repeats with the music
        const lookupBeat = this.effectiveBeat(chunkEnd);

        for (const lane of lanes) {
          const param = params[lane.target as keyof typeof params];
          if (!param) continue;
          const real = AUTOMATION_TARGETS[lane.target].toReal(laneValueAt(lane, lookupBeat));
          param.linearRampToValueAtTime(real, Math.max(atTime, ctx.currentTime + 0.005));
        }
        upTo = chunkEnd;
      }
      this.chanSchedBeat.set(track.tabId, upTo);
    }
  }

  /**
   * Route one note either to the track's assigned instrument preset or to its
   * raw oscillator node.
   */
  private emitNote(
    presetId: string | null,
    track: SequencerTrack,
    nodes: SeqNodes | undefined,
    note: { midiNote: number; velocity: number },
    oscState: OscillatorState,
    noteOnTime: number,
    noteOffTime: number,
    restoreFreq: number,
    restoreGain: number,
    songBeat: number,
  ): void {
    if (presetId) {
      getInstrumentEngine().playNote(
        presetId, note.midiNote,
        // Scale note velocity by the track's own amplitude so the mixer still applies
        note.velocity * oscState.amplitude,
        noteOnTime, noteOffTime - noteOnTime,
        {
          trackId: track.tabId,
          lanes: track.lanes,
          // Lane lookups use the looped position so automation repeats with the loop
          startBeat: this.effectiveBeat(songBeat),
          bpm: this.bpm,
        },
      );
      return;
    }
    if (nodes) {
      this.scheduleNote(nodes, note, oscState, noteOnTime, noteOffTime, restoreFreq, restoreGain);
    }
  }

  private scheduleNote(
    nodes: SeqNodes,
    note: { midiNote: number; velocity: number },
    oscState: OscillatorState,
    noteOnTime: number,
    noteOffTime: number,
    restoreFreq: number,
    restoreGain: number,
  ): void {
    const freq = midiToFreq(note.midiNote);
    const gainValue = (note.velocity / 127) * oscState.amplitude;

    // Note ON
    nodes.osc.frequency.cancelScheduledValues(noteOnTime);
    nodes.osc.frequency.setValueAtTime(freq, noteOnTime);
    nodes.gain.gain.cancelScheduledValues(noteOnTime);
    nodes.gain.gain.setValueAtTime(0, noteOnTime);
    nodes.gain.gain.linearRampToValueAtTime(gainValue, noteOnTime + 0.005);

    // Note OFF
    const offStart = Math.max(noteOnTime + 0.01, noteOffTime - 0.005);
    nodes.gain.gain.setValueAtTime(gainValue, offStart);
    nodes.gain.gain.linearRampToValueAtTime(0, noteOffTime);
    nodes.osc.frequency.setValueAtTime(restoreFreq, noteOffTime + 0.001);
    nodes.gain.gain.setValueAtTime(restoreGain * 0, noteOffTime + 0.001);
  }

  // ─── RAF playhead update ──────────────────────────────────────────────────────

  private rafLoop(ctx: AudioContext): void {
    const update = () => {
      if (!this.isPlaying) return;

      const now = ctx.currentTime;
      const bps = this.bpm / 60;
      const monotonicBeat = this.startBeat + (now - this.startAudioTime) * bps;
      const displayBeat = this.effectiveBeat(monotonicBeat);
      this.onPlayheadUpdate?.(displayBeat);

      this.rafId = requestAnimationFrame(update);
    };
    this.rafId = requestAnimationFrame(update);
  }

  private effectiveBeat(monotonicBeat: number): number {
    if (!this.loopEnabled) return monotonicBeat;
    const len = this.loopEndBeat - this.loopStartBeat;
    if (len <= 0) return monotonicBeat;
    if (monotonicBeat < this.loopStartBeat) return monotonicBeat;
    return this.loopStartBeat + ((monotonicBeat - this.loopStartBeat) % len);
  }

  // ─── Node management ─────────────────────────────────────────────────────────

  private buildSeqNodes(ctx: AudioContext, tabs: OscillatorTab[], state: SequencerState): void {
    const master = getAudioEngine().getMasterGain();
    if (!master) return;
    const rack = getChannelRack();

    for (const track of state.tracks) {
      const tab = tabs.find((t) => t.id === track.tabId);
      if (!tab) continue;
      // Instrument-driven tracks build a fresh voice per note — no persistent node
      if (getInstrumentEngine().getTrackInstrument(track.tabId)) continue;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const panner = ctx.createStereoPanner();

      applyWaveformToNode(ctx, osc, tab.oscillator);
      osc.frequency.value = tab.oscillator.frequency;
      gain.gain.value = 0;  // silent until note events
      // Pan now lives on the channel strip, so the voice sits centred here
      panner.pan.value = 0;

      osc.connect(gain);
      gain.connect(panner);
      // Raw-oscillator tracks get the same channel strip as instrument tracks,
      // so EQ, sends and sidechain work the same either way.
      panner.connect(rack.getInput(track.tabId) ?? master);
      osc.start();

      this.seqNodes.set(track.tabId, { osc, gain, panner });
    }
  }

  private teardownSeqNodes(): void {
    for (const [, nodes] of this.seqNodes) {
      nodes.gain.gain.cancelScheduledValues(0);
      nodes.gain.gain.setValueAtTime(0, 0);
      try { nodes.osc.stop(); } catch (_) { /* ignore */ }
      nodes.osc.disconnect();
      nodes.gain.disconnect();
      nodes.panner.disconnect();
    }
    this.seqNodes.clear();
  }

}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _seq: SequencerEngine | null = null;

export function getSequencerEngine(): SequencerEngine {
  if (!_seq) _seq = new SequencerEngine();
  return _seq;
}

// ─── Snap helper (re-exported for convenience) ────────────────────────────────

export function snapToBeat(beat: number, snap: SnapValue, shift = false): number {
  if (shift) return beat;
  const g = SNAP_BEATS[snap];
  return Math.round(beat / g) * g;
}
