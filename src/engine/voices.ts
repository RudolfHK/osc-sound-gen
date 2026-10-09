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
  /** Context time after which the voice is certainly silent. */
  end: number;
}

export class VoicePool {
  private voices = new Set<Voice>();

  add(gate: GainNode, sources: AudioScheduledSourceNode[], start: number, end: number): Voice {
    // Voices that end on their own are removed by the owner; ones that never
    // report back (drum hits) are pruned here once they've finished.
    if (this.voices.size > 256) this.prune(gate.context.currentTime);
    const v: Voice = { gate, sources, start, end };
    this.voices.add(v);
    return v;
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
   * Make room at the polyphony limit by fading out the voice that started
   * first — what hardware synths do. Dropping the new note instead would lose
   * exactly the note the listener is waiting for.
   */
  stealOldest(ctx: BaseAudioContext, fadeS = 0.015): boolean {
    const now = ctx.currentTime;
    let oldest: Voice | null = null;
    for (const v of this.voices) {
      if (v.gate.context !== ctx || v.end <= now) continue;
      if (!oldest || v.start < oldest.start) oldest = v;
    }
    if (!oldest) return false;
    this.cut(oldest, now, fadeS);
    this.voices.delete(oldest);
    return true;
  }

  private cut(v: Voice, now: number, fadeS: number): void {
    const g = v.gate.gain;
    holdAt(g, now);
    g.linearRampToValueAtTime(0, now + fadeS);
    for (const s of v.sources) {
      // A later stop() replaces the earlier one; stopping before the start
      // time means the source never sounds at all.
      try { s.stop(now + fadeS + 0.002); } catch { /* not started or already stopped */ }
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
