/**
 * Stereo width for a whole part.
 *
 * Instruments used to spread their oscillator layers across the stereo field
 * with one StereoPanner per layer. That made every voice stereo from the first
 * node on, so its filter, drive and amp all ran twice — about a fifth of the
 * audio thread on a busy song. Voices now stay mono, and the width is added
 * once per track, after they're summed:
 *
 *   L = mid + side,  R = mid − side,  side = a high-passed, 12 ms-delayed copy
 *
 * The left/right difference makes the part wide; the sum (L + R) is exactly
 * the mono signal, so it collapses to mono without comb filtering, and the
 * high-pass keeps the bass centred.
 */

/** Side level at full width, matched by ear and by the mid/side ratio of the old layer spread. */
const SIDE_GAIN = 0.6;
export const SIDE_DELAY_S = 0.012;
const SIDE_HIGHPASS_HZ = 280;

export interface Widener {
  /** Connect the part here (mono or stereo). */
  input: GainNode;
  /** Always stereo. */
  output: GainNode;
  /** Width 0–1 (the instrument's WIDTH). 0 bypasses the side path entirely. */
  setWidth(width: number): void;
  disconnect(): void;
}

export function createWidener(ctx: BaseAudioContext, width = 0): Widener {
  const input = ctx.createGain();
  const output = ctx.createGain();
  // Mono in becomes L = R = mid; stereo passes through
  output.channelCount = 2;
  output.channelCountMode = 'explicit';
  output.channelInterpretation = 'speakers';
  input.connect(output);

  const side = ctx.createGain();
  side.channelCount = 1;                 // fold the input to mono
  side.channelCountMode = 'explicit';
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = SIDE_HIGHPASS_HZ;
  hp.Q.value = 0.5;
  const delay = ctx.createDelay(0.05);
  delay.delayTime.value = SIDE_DELAY_S;
  const invert = ctx.createGain();
  invert.gain.value = -1;
  const merger = ctx.createChannelMerger(2);
  side.connect(hp);
  hp.connect(delay);
  delay.connect(merger, 0, 0);
  delay.connect(invert);
  invert.connect(merger, 0, 1);
  merger.connect(output);

  let linked = false;
  const setWidth = (w: number) => {
    const on = w > 0.01;
    side.gain.value = SIDE_GAIN * Math.max(0, Math.min(1, w));
    // An idle side path still costs a filter and a delay per quantum
    if (on && !linked) input.connect(side);
    if (!on && linked) input.disconnect(side);
    linked = on;
  };
  setWidth(width);

  return {
    input, output, setWidth,
    disconnect: () => {
      for (const n of [input, output, side, hp, delay, invert, merger]) {
        try { n.disconnect(); } catch { /* already gone */ }
      }
    },
  };
}
