import { getAudioEngine } from './audio';
import { getChannelRack } from './channelStrip';
import { emitEvent } from './emit';
import { expandArpCached } from './arpeggiator';
import { AUTOMATION_TARGETS, CHANNEL_TARGETS, laneValueAt } from './automation';
import { setPlayhead } from './playhead';
import {
  eventsInWindow, loopEngaged, monoToSong,
  type LoopConfig, type TimelineEvent, type TimelineInput,
} from './timeline';
import { SNAP_BEATS, effectiveTrackMutes } from '../utils/music';
import type { SequencerState, SnapValue, Track } from '../utils/music';
import type { OscillatorTab } from './oscillator';
import type { DrumPattern } from '../store/drumStore';

const SCHEDULE_AHEAD_S = 0.12; // schedule 120ms ahead
const SCHEDULER_MS = 25;       // run scheduler every 25ms
/** Channel automation is written in chunks this many beats long. */
const AUTOMATION_CHUNK_BEATS = 0.25;

export interface EngineInput {
  seq: SequencerState;
  tabs: OscillatorTab[];
  drumPatterns: DrumPattern[];
}

// ─── Sequencer engine ─────────────────────────────────────────────────────────

/**
 * Plays the arrangement. Each scheduler tick collects the events in the next
 * lookahead window from the pure timeline module and turns them into Web Audio
 * calls. The window boundaries are half-open and contiguous, so every event is
 * scheduled exactly once — even when the arrangement is edited mid-playback.
 */
export class SequencerEngine {
  private isPlaying = false;
  private bpm = 120;
  private loop: LoopConfig = { enabled: false, start: 0, end: 16 };
  private engaged = false;

  /** mono(t) = anchorMono + (t − anchorTime) · bps */
  private anchorTime = 0;
  private anchorMono = 0;
  private scheduledUpTo = 0;   // mono

  private input: TimelineInput | null = null;
  private tracks: Track[] = [];
  private tabs = new Map<string, OscillatorTab>();
  private chanSchedBeat = new Map<string, number>();

  private schedulerTimer: ReturnType<typeof setTimeout> | null = null;
  private rafId = 0;

  // ─── Configuration ──────────────────────────────────────────────────────────

  private configure({ seq, tabs, drumPatterns }: EngineInput): void {
    this.tracks = seq.tracks;
    this.tabs = new Map(tabs.map((t) => [t.id, t]));
    this.input = {
      tracks: seq.tracks,
      patterns: seq.patterns,
      drumPatterns: new Map(drumPatterns.map((p) => [p.id, p])),
      // Arpeggiation happens once per pattern and is cached, not per tick
      notesFor: (track, pattern) =>
        expandArpCached(`${track.id}:${pattern.id}`, pattern.notes, track.arp),
      metronome: seq.metronome,
      beatsPerBar: seq.beatsPerBar,
    };
    this.applyMixState(seq);
  }

  /** Push channel settings, mute and solo to every strip. */
  applyMixState(seq: SequencerState): void {
    const rack = getChannelRack();
    const mutes = effectiveTrackMutes(seq.tracks);
    for (const track of seq.tracks) {
      const automated = new Set(
        track.lanes.filter((l) => l.enabled && l.points.length > 0).map((l) => l.target as string),
      );
      rack.apply(track.id, track.channel, track.pan, automated);
      rack.setMute(track.id, mutes.get(track.id) ?? false);
    }
    rack.retain(new Set(seq.tracks.map((t) => t.id)));
  }

  // ─── Transport ──────────────────────────────────────────────────────────────

  async play(startBeat: number, input: EngineInput): Promise<void> {
    const ctx = await getAudioEngine().getOrCreateAudioContext();
    this.stop();

    const { seq } = input;
    this.bpm = seq.bpm;
    this.loop = { enabled: seq.loopEnabled, start: seq.loopStartBeat, end: seq.loopEndBeat };
    this.engaged = loopEngaged(this.loop, startBeat);
    this.configure(input);

    this.anchorTime = ctx.currentTime + 0.05; // 50ms latency buffer
    this.anchorMono = startBeat;
    this.scheduledUpTo = startBeat;
    this.chanSchedBeat.clear();
    this.isPlaying = true;

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
  }

  /**
   * Apply edits during playback. Tempo and loop changes re-anchor the clock at
   * the current song position: otherwise elapsed time would be rescaled by the
   * new tempo and the playhead would jump.
   */
  updateState(input: EngineInput): void {
    if (!this.isPlaying) {
      this.configure(input);
      return;
    }
    const { seq } = input;
    const newLoop = { enabled: seq.loopEnabled, start: seq.loopStartBeat, end: seq.loopEndBeat };
    const timingChanged = seq.bpm !== this.bpm ||
      newLoop.enabled !== this.loop.enabled || newLoop.start !== this.loop.start || newLoop.end !== this.loop.end;

    if (timingChanged) {
      const ctx = getAudioEngine().getAudioContext();
      if (ctx) {
        const nowMono = this.monoAt(ctx.currentTime);
        const songNow = monoToSong(nowMono, this.loop, this.engaged);
        const ahead = this.scheduledUpTo - nowMono;
        this.anchorTime = ctx.currentTime;
        this.anchorMono = songNow;
        this.loop = newLoop;
        this.bpm = seq.bpm;
        this.engaged = loopEngaged(this.loop, songNow);
        // Keep what's already queued; continue scheduling right after it
        this.scheduledUpTo = songNow + Math.max(0, ahead);
        this.chanSchedBeat.clear();
      }
    }
    this.configure(input);
  }

  get running(): boolean {
    return this.isPlaying;
  }

  /** Current song position, or null when stopped. */
  position(): number | null {
    const ctx = getAudioEngine().getAudioContext();
    if (!this.isPlaying || !ctx) return null;
    return monoToSong(Math.max(this.anchorMono, this.monoAt(ctx.currentTime)), this.loop, this.engaged);
  }

  // ─── Clock ──────────────────────────────────────────────────────────────────

  private monoAt(time: number): number {
    return this.anchorMono + (time - this.anchorTime) * (this.bpm / 60);
  }

  private timeAt(mono: number): number {
    return this.anchorTime + (mono - this.anchorMono) / (this.bpm / 60);
  }

  // ─── Scheduler ──────────────────────────────────────────────────────────────

  private schedulerLoop(): void {
    if (!this.isPlaying) return;
    const ctx = getAudioEngine().getAudioContext();
    if (!ctx || !this.input) return;

    const horizon = this.monoAt(ctx.currentTime + SCHEDULE_AHEAD_S);
    if (horizon > this.scheduledUpTo) {
      const events = eventsInWindow(this.input, this.scheduledUpTo, horizon, this.loop, this.engaged);
      for (const e of events) this.emit(e, ctx);
      this.scheduleChannelAutomation(horizon, ctx);
      this.scheduledUpTo = horizon;
    }

    this.schedulerTimer = setTimeout(() => this.schedulerLoop(), SCHEDULER_MS);
  }

  private emit(e: TimelineEvent, ctx: AudioContext): void {
    // Never schedule into the past — late events play immediately
    emitEvent(e, Math.max(ctx.currentTime, this.timeAt(e.monoBeat)), ctx, this.bpm, this.tabs);
  }

  /**
   * Write channel-strip automation (volume, pan, EQ, sends) ahead of the
   * playhead in short chunks. These live on long-lived nodes, so each chunk
   * ramps toward the lane's value at the chunk's end rather than being
   * rewritten from scratch every tick.
   */
  private scheduleChannelAutomation(horizon: number, ctx: AudioContext): void {
    const rack = getChannelRack();
    for (const track of this.tracks) {
      const lanes = track.lanes.filter(
        (l) => l.enabled && l.points.length > 0 && CHANNEL_TARGETS.includes(l.target),
      );
      if (lanes.length === 0) continue;
      const params = rack.getParams(track.id);
      if (!params) continue;

      let upTo = this.chanSchedBeat.get(track.id) ?? this.scheduledUpTo;
      // Guard against a huge catch-up after the tab was backgrounded
      if (horizon - upTo > 8) upTo = horizon - 1;

      while (upTo < horizon) {
        const chunkEnd = upTo + AUTOMATION_CHUNK_BEATS;
        const atTime = Math.max(this.timeAt(chunkEnd), ctx.currentTime + 0.005);
        const songBeat = monoToSong(chunkEnd, this.loop, this.engaged);
        for (const lane of lanes) {
          const param = params[lane.target as keyof typeof params];
          if (!param) continue;
          param.linearRampToValueAtTime(AUTOMATION_TARGETS[lane.target].toReal(laneValueAt(lane, songBeat)), atTime);
        }
        upTo = chunkEnd;
      }
      this.chanSchedBeat.set(track.id, upTo);
    }
  }

  // ─── Playhead ───────────────────────────────────────────────────────────────

  private rafLoop(ctx: AudioContext): void {
    const update = () => {
      if (!this.isPlaying) return;
      const mono = this.monoAt(ctx.currentTime);
      // Before the latency buffer elapses, hold at the start position
      setPlayhead(monoToSong(Math.max(this.anchorMono, mono), this.loop, this.engaged));
      this.rafId = requestAnimationFrame(update);
    };
    this.rafId = requestAnimationFrame(update);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _seq: SequencerEngine | null = null;

export function getSequencerEngine(): SequencerEngine {
  if (!_seq) _seq = new SequencerEngine();
  return _seq;
}

// ─── Snap helper ──────────────────────────────────────────────────────────────

export function snapToBeat(beat: number, snap: SnapValue, shift = false): number {
  if (shift) return beat;
  const g = SNAP_BEATS[snap];
  return Math.round(beat / g) * g;
}
