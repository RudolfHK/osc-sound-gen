/**
 * Registry of sounding (and pre-scheduled) voices, so the transport can cut
 * them off.
 *
 * Notes are scheduled up to a lookahead ahead of time and each carries its own
 * envelope and stop time. Without a handle on them, stopping the transport only
 * stops *new* notes: held pads, long releases and anything already queued play
 * out to the end. Every voice registers its output gate here; `silence()` ramps
 * those gates to zero in a few milliseconds (short enough to feel instant,
 * long enough not to click) and stops the sources.
 */

/** Fade used for a hard stop — about 4 ms is inaudible as a fade but avoids a click. */
export const HARD_STOP_FADE_S = 0.004;

interface Voice {
  gate: GainNode;
  sources: AudioScheduledSourceNode[];
  /** Context time the voice starts. */
  start: number;
  /** Context time its release begins (note off). */
  releaseAt: number;
  /** Context time after which the voice is certainly silent. */
  end: number;
  /** Which part it belongs to (a track), for the per-part tail limit. */
  group: string;
}

export interface VoiceInfo {
  releaseAt?: number;
  group?: string;
  /** Release tails a part may have ringing at once; older tails are faded out. */
  maxTails?: number;
}

/** Fade for a tail cut to make room — long enough to be smooth under new notes. */
const TAIL_FADE_S = 0.03;

export class VoicePool {
  private voices = new Set<Voice>();

  add(gate: GainNode, sources: AudioScheduledSourceNode[], start: number, end: number, info: VoiceInfo = {}): Voice {
    // Voices that end on their own are removed by the owner; ones that never
    // report back (drum hits) are pruned here once they've finished.
    if (this.voices.size > 256) this.prune(gate.context.currentTime);
    const v: Voice = { gate, sources, start, end, releaseAt: info.releaseAt ?? end, group: info.group ?? '' };
    if (info.maxTails !== undefined && v.group) this.limitTails(v, info.maxTails);
    this.voices.add(v);
    return v;
  }

  /**
   * Fast chords over a long-release pad pile up tails that are mostly inaudible
   * under the new notes but cost as much as sounding voices. Keep the newest
   * few per part and fade the rest as the new note starts.
   */
  private limitTails(next: Voice, maxTails: number): void {
    const at = next.start;
    const tails: Voice[] = [];
    for (const v of this.voices) {
      if (v.group === next.group && v.gate.context === next.gate.context && v.releaseAt <= at && v.end > at) tails.push(v);
    }
    if (tails.length < maxTails) return;
    tails.sort((a, b) => a.releaseAt - b.releaseAt);
    const now = next.gate.context.currentTime;
    for (const v of tails.slice(0, tails.length - maxTails + 1)) {
      const from = Math.max(now, at);
      this.cut(v, from, TAIL_FADE_S);
      // Stays registered until it's silent: a stop before `from` must still cut it
      v.end = from + TAIL_FADE_S;
    }
  }

  remove(v: Voice): void {
    this.voices.delete(v);
  }

  /** Voices still sounding or waiting to start in `ctx`. */
  count(ctx: BaseAudioContext): number {
    let n = 0;
    const now = ctx.currentTime;
    for (const v of this.voices) if (v.gate.context === ctx && v.end > now) n++;
    return n;
  }

  /** Cut every voice off now — including ones scheduled to start later. */
  silence(fadeS = HARD_STOP_FADE_S): void {
    for (const v of this.voices) {
      const now = v.gate.context.currentTime;
      if (v.end > now) this.cut(v, now, fadeS);
    }
    this.voices.clear();
  }

  /**
   * Make room at the polyphony limit. A voice that is already releasing goes
   * first (the oldest tail); otherwise the voice that started first — what
   * hardware synths do. Dropping the new note instead would lose exactly the
   * note the listener is waiting for.
   */
  stealOldest(ctx: BaseAudioContext, fadeS = 0.015): boolean {
    const now = ctx.currentTime;
    let tail: Voice | null = null;
    let oldest: Voice | null = null;
    for (const v of this.voices) {
      if (v.gate.context !== ctx || v.end <= now) continue;
      if (v.releaseAt <= now && (!tail || v.releaseAt < tail.releaseAt)) tail = v;
      if (!oldest || v.start < oldest.start) oldest = v;
    }
    const victim = tail ?? oldest;
    if (!victim) return false;
    this.cut(victim, now, fadeS);
    this.voices.delete(victim);
    return true;
  }

  private cut(v: Voice, at: number, fadeS: number): void {
    const g = v.gate.gain;
    holdAt(g, at);
    g.linearRampToValueAtTime(0, at + fadeS);
    for (const s of v.sources) {
      // A later stop() replaces the earlier one; stopping before the start
      // time means the source never sounds at all.
      try { s.stop(at + fadeS + 0.002); } catch { /* not started or already stopped */ }
    }
  }

  private prune(now: number): void {
    for (const v of this.voices) if (v.end <= now) this.voices.delete(v);
  }
}

/**
 * Freeze a param at its current value, discarding everything scheduled after
 * `time`. Falls back to reading `.value` where cancelAndHoldAtTime is missing
 * (Firefox).
 */
export function holdAt(param: AudioParam, time: number): void {
  const p = param as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (typeof p.cancelAndHoldAtTime === 'function') {
    p.cancelAndHoldAtTime(time);
  } else {
    const v = param.value;
    param.cancelScheduledValues(time);
    param.setValueAtTime(v, time);
  }
}
