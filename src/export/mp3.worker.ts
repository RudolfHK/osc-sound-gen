/// <reference lib="webworker" />
/**
 * MP3 encoding off the main thread.
 *
 * Uses @breezystack/lamejs, a JavaScript port of LAME (LGPL-3.0). It lives in
 * this worker so it ships as its own file — the encoder stays separately
 * replaceable, as the LGPL asks — and so encoding a whole song never blocks
 * the UI.
 */

import { Mp3Encoder } from '@breezystack/lamejs';

export interface Mp3Request {
  channels: Float32Array[];
  sampleRate: number;
  kbps: number;
  /** Encode as mono (downmixed) instead of stereo. */
  mono: boolean;
}

export type Mp3Message =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; data: Uint8Array }
  | { type: 'error'; message: string };

const FRAME = 1152; // samples per MPEG-1 Layer III frame

function toInt16(x: Float32Array): Int16Array {
  const out = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const s = Math.max(-1, Math.min(1, x[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

self.onmessage = (ev: MessageEvent<Mp3Request>) => {
  try {
    const { sampleRate, kbps, mono } = ev.data;
    let chans = ev.data.channels;
    if (mono || chans.length === 1) {
      const n = chans[0].length;
      const m = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (const c of chans) s += c[i];
        m[i] = s / chans.length;
      }
      chans = [m];
    }

    const pcm = chans.map(toInt16);
    const enc = new Mp3Encoder(pcm.length, sampleRate, kbps);
    const parts: Uint8Array[] = [];
    const total = pcm[0].length;
    // A progress message per ~5 % keeps the UI live without flooding it
    const reportEvery = Math.max(FRAME, Math.floor(total / 20 / FRAME) * FRAME);

    for (let i = 0; i < total; i += FRAME) {
      const l = pcm[0].subarray(i, i + FRAME);
      const chunk = pcm.length > 1 ? enc.encodeBuffer(l, pcm[1].subarray(i, i + FRAME)) : enc.encodeBuffer(l);
      if (chunk.length) parts.push(new Uint8Array(chunk));
      if (i % reportEvery === 0) {
        (self as unknown as Worker).postMessage({ type: 'progress', fraction: i / total } satisfies Mp3Message);
      }
    }
    const tail = enc.flush();
    if (tail.length) parts.push(new Uint8Array(tail));

    const size = parts.reduce((s, p) => s + p.length, 0);
    const data = new Uint8Array(size);
    let o = 0;
    for (const p of parts) { data.set(p, o); o += p.length; }
    (self as unknown as Worker).postMessage({ type: 'done', data } satisfies Mp3Message, [data.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', message: (err as Error).message } satisfies Mp3Message);
  }
};
