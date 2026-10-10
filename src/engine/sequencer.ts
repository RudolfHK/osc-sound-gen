import { getAudioEngine } from './audio';
import { getChannelRack, type InstrumentShape } from './channelStrip';
import { getSettings, subscribeSettings } from '../store/settings';
import { getInstrumentEngine, bodyOnStrip } from './instruments';
import { getDrumSynth } from './sampler';
import { getEffectsBus } from './effects';
import { emitEvent, worthChasing } from './emit';
import { expandArpCached, pruneArpCache } from './arpeggiator';
import { Ticker } from './ticker';
import { AUTOMATION_TARGETS, CHANNEL_TARGETS, findLane, laneValueAt } from './automation';
import { setPlayhead } from './playhead';
import {
  eventsInWindow, heldNotesAt, loopEngaged, monoToSong,
  type LoopConfig, type TimelineEvent, type TimelineInput,
} from './timeline';
import { effectiveTrackMutes } from '../utils/music';
import type { SequencerState, Track } from '../utils/music';
import type { OscillatorTab } from './oscillator';
import type { DrumPattern } from '../store/drumStore';

const SCHEDULER_MS = 25;       // run the scheduler every 25 ms
/** Normal lookahead. Grows when ticks arrive late (a busy or slow machine). */
const LOOKAHEAD_MIN_S = 0.12;
const LOOKAHEAD_MAX_S = 0.4;
/**
 * After a stall longer than this (the tab was frozen, the machine swapped),
 * the notes that were missed are dropped rather than all fired at once.
 */
const MAX_OVERDUE_S = 0.05;
/**
 * Extra lookahead per millisecond of scheduling work per second of music:
 * 100 events/s at 1 ms each (a dense bar on a slow machine) adds 0.2 s.
 */
const DENSE_REACH = 0.002;
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
  /** Last mix state pushed, reapplied after a stop drops automation. */
  private lastSeq: SequencerState | null = null;

  private ticker = new Ticker();
  private lookahead = LOOKAHEAD_MIN_S;
  private lastTickAt = 0;
  /** Main-thread milliseconds it takes to schedule one event (smoothed). */
  private costPerEvent = 0.2;
  /** Events per second of music in the windows just scheduled (smoothed). */
  private density = 0;
  /**
   * Bumped by every play and stop. `play` awaits the audio context; if a stop
   * (or another play) happens meanwhile, the stale play must not start.
   */
  private generation = 0;
  private rafId = 0;

  // ─── Configuration ──────────────────────────────────────────────────────────

  private configure({ seq, tabs, drumPatterns }: EngineInput): void {
    this.tracks = seq.tracks;
    this.tabs = new Map(tabs.map((t) => [t.id, t]));
    pruneArpCache(new Set(seq.tracks.flatMap((t) => t.clips.map((c) => `${t.id}:${c.patternId}`))));
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

  /** Push channel settings, mute and solo — and each track's instrument width and sends — to every strip. */
  applyMixState(seq: SequencerState): void {
    this.lastSeq = seq;
    const rack = getChannelRack();
    const mutes = effectiveTrackMutes(seq.tracks);
    for (const track of seq.tracks) {
      const automated = new Set(
        track.lanes.filter((l) => l.enabled && l.points.length > 0).map((l) => l.target as string),
      );
      rack.apply(track.id, track.channel, track.pan, automated);
      rack.setMute(track.id, mutes.get(track.id) ?? false);
      rack.setInstrument(track.id, shapeOf(track));
    }
    rack.retain(new Set(seq.tracks.map((t) => t.id)));
  }

  /** Library edits or Eco mode changed how instruments sound: re-apply the mix. */
  refreshMix(): void {
    if (this.lastSeq) this.applyMixState(this.lastSeq);
  }

  // ─── Transport ──────────────────────────────────────────────────────────────

  /**
   * Start playing at `startBeat`. `countInBeats` clicks the metronome for
   * that many beats first; the song starts after them.
   */
  async play(startBeat: number, input: EngineInput, { countInBeats = 0 } = {}): Promise<void> {
    const gen = ++this.generation;
    const ctx = await getAudioEngine().getOrCreateAudioContext();
    if (gen !== this.generation) return; // stopped (or restarted) while waiting
    this.halt();

    const { seq } = input;
    this.bpm = seq.bpm;
    this.loop = { enabled: seq.loopEnabled, start: seq.loopStartBeat, end: seq.loopEndBeat };
    this.engaged = loopEngaged(this.loop, startBeat);
    this.configure(input);

    const bps = seq.bpm / 60;
    const firstBeat = ctx.currentTime + 0.05; // 50ms latency buffer
    for (let i = 0; i < countInBeats; i++) {
      emitEvent({ kind: 'click', monoBeat: 0, accent: i % seq.beatsPerBar === 0 }, firstBeat + i / bps, ctx, this.bpm, this.tabs);
    }
    // Until the count-in has passed the scheduler finds nothing due, and the
    // playhead holds at the start
    this.anchorTime = firstBeat + countInBeats / bps;
    this.anchorMono = startBeat;
    this.scheduledUpTo = startBeat;
    this.chanSchedBeat.clear();
    this.isPlaying = true;
    this.lookahead = LOOKAHEAD_MIN_S;
    this.lastTickAt = performance.now();

    this.chase(startBeat, ctx);
    this.ticker.start(SCHEDULER_MS, () => this.tick());
    this.tick();
    this.rafLoop(ctx);
  }

  stop(): void {
    this.generation++;
    this.halt();
  }

  /** Stop the scheduler and cut everything that is sounding. */
  private halt(): void {
    this.isPlaying = false;
    this.ticker.stop();
    cancelAnimationFrame(this.rafId);
    this.silence();
  }

  /**
   * Pick up notes already being held at the start position, so starting or
   * seeking into a long chord is heard straight away rather than after it ends.
   */
  private chase(songBeat: number, ctx: AudioContext): void {
    if (!this.input) return;
    const bps = this.bpm / 60;
    for (const e of heldNotesAt(this.input, songBeat)) {
      if (!worthChasing(e, e.intoBeats / bps)) continue;
      emitEvent(e, this.anchorTime, ctx, this.bpm, this.tabs);
    }
  }

  /**
   * Hard stop. Notes are scheduled ahead and carry their own release, so
   * halting the scheduler alone lets held notes, queued notes and effect tails
   * play out. Stopping (and seeking, which restarts playback) must be heard
   * at once, the way it is in any DAW.
   */
  private silence(): void {
    getInstrumentEngine().silenceAll();
    getDrumSynth().silenceAll();
    getEffectsBus().flushTails();
    getChannelRack().haltAutomation();
    if (this.lastSeq) this.applyMixState(this.lastSeq);
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

  private tick(): void {
    if (!this.isPlaying || !this.input) return;
    const audio = getAudioEngine();
    // While an export renders, "the" context is the offline one — wait it out
    if (audio.isRenderingOffline) return;
    const ctx = audio.getAudioContext();
    if (!ctx) return;

    // A tick that arrives late means the main thread is busy: look further
    // ahead so notes are queued before they're due. Dense passages get a
    // longer reach up front — scheduling them is itself the work that makes
    // the next tick late — sized from how many events are coming and what
    // each costs to schedule on this machine. Relax again slowly.
    const now = performance.now();
    const lateBy = (now - this.lastTickAt - SCHEDULER_MS) / 1000;
    this.lastTickAt = now;
    const busyMsPerS = this.density * this.costPerEvent;
    const floor = Math.min(LOOKAHEAD_MAX_S, LOOKAHEAD_MIN_S + busyMsPerS * DENSE_REACH);
    this.lookahead = lateBy > 0.02
      ? Math.min(LOOKAHEAD_MAX_S, Math.max(this.lookahead, lateBy + floor))
      : Math.max(floor, this.lookahead * 0.98);

    // After a long stall, skip what was missed instead of firing it in a burst
    const overdueFrom = this.monoAt(ctx.currentTime - MAX_OVERDUE_S);
    if (this.scheduledUpTo < overdueFrom) this.scheduledUpTo = overdueFrom;

    const horizon = this.monoAt(ctx.currentTime + this.lookahead);
    if (horizon > this.scheduledUpTo) {
      const t0 = performance.now();
      const events = eventsInWindow(this.input, this.scheduledUpTo, horizon, this.loop, this.engaged);
      for (const e of events) this.emit(e, ctx);
      this.scheduleChannelAutomation(horizon, ctx);
      const windowS = (horizon - this.scheduledUpTo) / (this.bpm / 60);
      this.scheduledUpTo = horizon;
      if (events.length) {
        this.costPerEvent = this.costPerEvent * 0.8 + ((performance.now() - t0) / events.length) * 0.2;
      }
      this.density = this.density * 0.8 + (events.length / Math.max(0.01, windowS)) * 0.2;
    }
  }

  private emit(e: TimelineEvent, ctx: AudioContext): void {
    // Never schedule into the past — a slightly late event plays immediately
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

/**
 * The part of a track's sound that lives on its strip: the preset's stereo
 * width and its own effect sends. Eco mode plays live audio in mono; exports
 * always render at full quality.
 */
function shapeOf(track: Track): InstrumentShape {
  if (track.source.type === 'drums') {
    // The kit's room (Effects → drum sends); kicks bypass it on the strip
    const d = getEffectsBus().getDrumSends();
    return { width: 0, send: { reverb: d.reverb, delay: d.delay, chorus: 0 } };
  }
  if (track.source.type !== 'preset') return { width: 0, send: { reverb: 0, delay: 0, chorus: 0 } };
  const p = getInstrumentEngine().resolve(track.source.presetId, track.patch);
  if (!p) return { width: 0, send: { reverb: 0, delay: 0, chorus: 0 } };
  const eco = getSettings().ecoMode && !getAudioEngine().isRenderingOffline;
  // A drive lane distorts every note, so the body has to stay in the voice
  const driven = !!findLane(track.lanes, 'drive');
  return { width: eco ? 0 : p.width, send: p.send, body: bodyOnStrip(p) && !driven ? p.body : null };
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _seq: SequencerEngine | null = null;

export function getSequencerEngine(): SequencerEngine {
  if (!_seq) {
    const engine = new SequencerEngine();
    _seq = engine;
    // The kit's sends live on drum tracks' strips
    getEffectsBus().onDrumSendsChange = () => {
      if (!getAudioEngine().isRenderingOffline) engine.refreshMix();
    };
    // Eco mode changes the width every strip applies
    let eco = getSettings().ecoMode;
    subscribeSettings(() => {
      if (getSettings().ecoMode === eco) return;
      eco = getSettings().ecoMode;
      engine.refreshMix();
    });
  }
  return _seq;
}
