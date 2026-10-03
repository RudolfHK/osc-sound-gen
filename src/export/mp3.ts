import { id3v2 } from './id3';
import type { PcmAudio } from './wav';
import type { Mp3Message, Mp3Request } from './mp3.worker';

/** Bitrates offered for MP3, in kbps (constant bitrate). */
export const MP3_BITRATES = [128, 160, 192, 256, 320] as const;
export type Mp3Bitrate = typeof MP3_BITRATES[number];

/** MPEG-1 Layer III only defines these rates. */
export const MP3_SAMPLE_RATES = [32000, 44100, 48000];

export interface Mp3Options {
  kbps: Mp3Bitrate;
  mono: boolean;
  tags: { title?: string; artist?: string; album?: string };
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** Encode PCM to an MP3 file (ID3 tag + frames) in a worker. */
export function encodeMp3(audio: PcmAudio, opts: Mp3Options): Promise<Uint8Array> {
  if (!MP3_SAMPLE_RATES.includes(audio.sampleRate)) {
    return Promise.reject(new Error(`MP3 can't be ${audio.sampleRate / 1000} kHz — use 44.1 or 48 kHz.`));
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./mp3.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { worker.terminate(); opts.signal?.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(new DOMException('Export cancelled', 'AbortError')); };
    opts.signal?.addEventListener('abort', abort);

    worker.onmessage = (ev: MessageEvent<Mp3Message>) => {
      const m = ev.data;
      if (m.type === 'progress') opts.onProgress?.(m.fraction);
      else if (m.type === 'error') { finish(); reject(new Error(m.message)); }
      else {
        finish();
        const tag = id3v2({ ...opts.tags, encoder: 'OSC (LAME)' });
        const out = new Uint8Array(tag.length + m.data.length);
        out.set(tag, 0);
        out.set(m.data, tag.length);
        resolve(out);
      }
    };
    worker.onerror = (e) => { finish(); reject(new Error(e.message || 'MP3 encoder failed to load')); };

    // Copy the channels: transferring would detach the caller's buffers
    const req: Mp3Request = {
      channels: audio.channels.map((c) => c.slice()),
      sampleRate: audio.sampleRate,
      kbps: opts.kbps,
      mono: opts.mono,
    };
    worker.postMessage(req, req.channels.map((c) => c.buffer));
  });
}

/** Approximate size of a CBR MP3. */
export function mp3Size(seconds: number, kbps: number): number {
  return Math.round(seconds * kbps * 125);
}
