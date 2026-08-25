import { getAudioEngine, applyWaveformToNode } from './audio';
import { getInstrumentEngine } from './instruments';
import { midiToFreq, beatsToSeconds, SNAP_BEATS } from '../utils/music';
import type { SequencerState, SequencerTrack, SnapValue } from '../utils/music';
import type { OscillatorState, OscillatorTab } from './oscillator';

const SCHEDULE_AHEAD_S = 0.12; // schedule 120ms ahead
const SCHEDULER_MS = 25;       // run scheduler every 25ms

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
    this.configure(state, tabs);
    // Update pan on live nodes
    const ctx = getAudioEngine().getAudioContext();
    if (!ctx) return;
    for (const track of state.tracks) {
      const nodes = this.seqNodes.get(track.tabId);
      if (nodes) nodes.panner.pan.setTargetAtTime(track.pan, ctx.currentTime, 0.01);
    }
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

    for (const track of this.tracks) {
      const nodes = this.seqNodes.get(track.tabId);
      const tab = this.tabMap.get(track.tabId);
      if (!tab) continue;
      // A track either plays through an assigned instrument preset or its own
      // oscillator node — one of the two must be available.
      const presetId = getInstrumentEngine().getTrackInstrument(track.tabId);
      if (!nodes && !presetId) continue;

      const restoreFreq = tab.oscillator.frequency;
      const restoreGain = tab.oscillator.amplitude * tab.oscillator.masterVolume;

      for (const note of track.notes) {
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

              this.emitNote(presetId, track.pan, nodes, note, tab.oscillator,
                noteOnTime, noteOffTime, restoreFreq, restoreGain);
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

            this.emitNote(presetId, track.pan, nodes, note, tab.oscillator,
              noteOnTime, noteOffTime, restoreFreq, restoreGain);
            this.scheduledKeys.add(key);
          }
        }
      }
    }

    this.scheduleUpToBeat = scheduleToMonotonic;
    this.schedulerTimer = setTimeout(() => this.schedulerLoop(), SCHEDULER_MS);
  }

  /**
   * Route one note either to the track's assigned instrument preset or to its
   * raw oscillator node.
   */
  private emitNote(
    presetId: string | null,
    pan: number,
    nodes: SeqNodes | undefined,
    note: { midiNote: number; velocity: number },
    oscState: OscillatorState,
    noteOnTime: number,
    noteOffTime: number,
    restoreFreq: number,
    restoreGain: number,
  ): void {
    if (presetId) {
      getInstrumentEngine().playNote(
        presetId, note.midiNote,
        // Scale note velocity by the track's own amplitude so the mixer still applies
        note.velocity * oscState.amplitude,
        noteOnTime, noteOffTime - noteOnTime, pan,
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
      panner.pan.value = track.pan;

      osc.connect(gain);
      gain.connect(panner);
      panner.connect(master);
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
