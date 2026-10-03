/**
 * Uncompressed WAV writer — 16-bit and 24-bit integer PCM, or 32-bit float.
 *
 * Works on plain Float32Array channels rather than AudioBuffer so it runs in
 * workers and tests as well as the page.
 */

export interface PcmAudio {
  sampleRate: number;
  channels: Float32Array[];
}

export type WavBitDepth = 16 | 24 | 32;

export interface WavOptions {
  bitDepth: WavBitDepth;
  /** Triangular dither before quantizing to 16-bit. Ignored for 24 and 32. */
  dither?: boolean;
  /** Injectable for tests; defaults to Math.random. */
  random?: () => number;
}

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_IEEE_FLOAT = 3;

export function encodeWav(audio: PcmAudio, opts: WavOptions): ArrayBuffer {
  const { sampleRate, channels } = audio;
  const numChannels = channels.length;
  const frames = channels[0]?.length ?? 0;
  const isFloat = opts.bitDepth === 32;
  const bytesPerSample = opts.bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = frames * blockAlign;

  // Float WAV carries an 18-byte fmt chunk and a fact chunk, as the spec asks
  const fmtSize = isFloat ? 18 : 16;
  const factSize = isFloat ? 12 : 0;
  const headerSize = 12 + (8 + fmtSize) + factSize + 8;
  const ab = new ArrayBuffer(headerSize + dataSize);
  const v = new DataView(ab);
  let o = 0;

  const str = (s: string) => { for (let i = 0; i < 4; i++) v.setUint8(o++, s.charCodeAt(i)); };
  const u32 = (n: number) => { v.setUint32(o, n, true); o += 4; };
  const u16 = (n: number) => { v.setUint16(o, n, true); o += 2; };

  str('RIFF'); u32(ab.byteLength - 8); str('WAVE');
  str('fmt '); u32(fmtSize);
  u16(isFloat ? WAVE_FORMAT_IEEE_FLOAT : WAVE_FORMAT_PCM);
  u16(numChannels);
  u32(sampleRate);
  u32(sampleRate * blockAlign);
  u16(blockAlign);
  u16(opts.bitDepth);
  if (isFloat) {
    u16(0); // cbSize
    str('fact'); u32(4); u32(frames);
  }
  str('data'); u32(dataSize);

  const rand = opts.random ?? Math.random;
  const dither = opts.bitDepth === 16 && !!opts.dither;

  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let s = channels[ch][i];
      if (isFloat) {
        v.setFloat32(o, s, true);
        o += 4;
        continue;
      }
      if (opts.bitDepth === 16) {
        let x = s * 32767;
        // TPDF dither: the difference of two uniform values, ±1 LSB peak.
        // Turns quantization distortion on quiet fades into benign noise.
        if (dither) x += rand() - rand();
        x = Math.round(x);
        v.setInt16(o, Math.max(-32768, Math.min(32767, x)), true);
        o += 2;
      } else {
        s = Math.max(-1, Math.min(1, s));
        const x = Math.max(-8388608, Math.min(8388607, Math.round(s * 8388607)));
        v.setUint8(o, x & 0xff);
        v.setUint8(o + 1, (x >> 8) & 0xff);
        v.setUint8(o + 2, (x >> 16) & 0xff);
        o += 3;
      }
    }
  }
  return ab;
}

/** Size in bytes a WAV of this shape will have — for the export dialog's estimate. */
export function wavSize(frames: number, numChannels: number, bitDepth: WavBitDepth): number {
  const header = bitDepth === 32 ? 58 : 44;
  return header + frames * numChannels * (bitDepth / 8);
}

export function audioBufferToPcm(buf: AudioBuffer): PcmAudio {
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buf.numberOfChannels; ch++) channels.push(buf.getChannelData(ch));
  return { sampleRate: buf.sampleRate, channels };
}
