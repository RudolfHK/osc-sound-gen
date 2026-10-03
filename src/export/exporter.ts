/**
 * Export orchestration: render → normalize → encode → (zip) → file.
 */

import { zipSync } from 'fflate';
import { renderArrangement, renderStems, RenderCancelled, type RenderInput } from './render';
import { encodeWav, audioBufferToPcm, type PcmAudio, type WavBitDepth } from './wav';
import { encodeMp3, type Mp3Bitrate } from './mp3';
import { encodeMidi } from './midi';
import { normalizeInPlace, integratedLoudness, samplePeak, gainToDb, type LevelReport, type Normalize } from './loudness';

export type ExportFormat = 'wav' | 'mp3' | 'midi';

export interface ExportSettings {
  format: ExportFormat;
  /** Stems: one file per track, zipped. */
  stems: boolean;
  sampleRate: number;
  bitDepth: WavBitDepth;
  dither: boolean;
  kbps: Mp3Bitrate;
  mono: boolean;
  normalize: Normalize;
  maxTailSeconds: number;
  bakeArpeggiator: boolean;
}

export const DEFAULT_EXPORT: ExportSettings = {
  format: 'wav',
  stems: false,
  sampleRate: 48000,
  bitDepth: 24,
  dither: true,
  kbps: 320,
  mono: false,
  normalize: { mode: 'off' },
  maxTailSeconds: 4,
  bakeArpeggiator: true,
};

export interface ExportResult {
  blob: Blob;
  filename: string;
  /** Levels of the exported mix (not reported for stems or MIDI). */
  levels?: LevelReport;
  seconds?: number;
  files?: number;
}

export interface Progress {
  phase: 'render' | 'encode' | 'zip';
  fraction: number;
  detail?: string;
}

export function safeFileName(name: string): string {
  return name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'export';
}

/** Turn finished PCM into a file in the chosen format. */
async function encodeAudio(
  pcm: PcmAudio,
  s: ExportSettings,
  title: string,
  onProgress: (p: Progress) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (s.format === 'mp3') {
    return encodeMp3(pcm, {
      kbps: s.kbps, mono: s.mono, tags: { title, album: 'OSC' }, signal,
      onProgress: (f) => onProgress({ phase: 'encode', fraction: f }),
    });
  }
  onProgress({ phase: 'encode', fraction: 0 });
  const out = new Uint8Array(encodeWav(pcm, { bitDepth: s.bitDepth, dither: s.dither }));
  onProgress({ phase: 'encode', fraction: 1 });
  return out;
}

/**
 * Everything this module produces is backed by a plain ArrayBuffer; recent
 * TypeScript can't prove that for a bare Uint8Array, which Blob requires.
 */
function bytes(u: Uint8Array): Uint8Array<ArrayBuffer> {
  return u as Uint8Array<ArrayBuffer>;
}

const MIME: Record<ExportFormat, string> = { wav: 'audio/wav', mp3: 'audio/mpeg', midi: 'audio/midi' };
const EXT: Record<ExportFormat, string> = { wav: 'wav', mp3: 'mp3', midi: 'mid' };

/** Export the arrangement over a beat range. */
export async function exportArrangement(
  input: RenderInput,
  s: ExportSettings,
  range: { startBeat: number; endBeat: number; label: string },
  projectName: string,
  onProgress: (p: Progress) => void,
  signal?: AbortSignal,
): Promise<ExportResult> {
  const base = safeFileName(projectName) + (range.label ? `-${safeFileName(range.label)}` : '');

  if (s.format === 'midi') {
    const midiBytes = encodeMidi(input.seq, projectName, {
      startBeat: range.startBeat, endBeat: range.endBeat,
      bakeArpeggiator: s.bakeArpeggiator, drumPatterns: input.drumPatterns,
    });
    return { blob: new Blob([bytes(midiBytes)], { type: MIME.midi }), filename: `${base}.mid` };
  }

  const renderOpts = {
    startBeat: range.startBeat,
    endBeat: range.endBeat,
    sampleRate: s.format === 'mp3' ? Math.min(s.sampleRate, 48000) : s.sampleRate,
    maxTailSeconds: s.maxTailSeconds,
    signal,
  };

  if (s.stems) {
    const stems = await renderStems(input, {
      ...renderOpts,
      onProgress: (f, name) => onProgress({ phase: 'render', fraction: f, detail: name }),
    });
    if (stems.length === 0) throw new Error('No tracks with clips to export.');
    // Stems keep their relative levels — normalizing each would break the balance
    const files: Record<string, Uint8Array> = {};
    const used = new Set<string>();
    for (let i = 0; i < stems.length; i++) {
      const { track, buffer } = stems[i];
      let name = `${String(i + 1).padStart(2, '0')}-${safeFileName(track.name)}.${EXT[s.format]}`;
      while (used.has(name)) name = name.replace(/(\.\w+)$/, '-2$1');
      used.add(name);
      files[name] = await encodeAudio(audioBufferToPcm(buffer), s, `${projectName} — ${track.name}`,
        (p) => onProgress({ ...p, fraction: (i + p.fraction) / stems.length, detail: track.name }), signal);
    }
    onProgress({ phase: 'zip', fraction: 0 });
    // WAV and MP3 barely compress; store them so zipping is instant
    const zip = zipSync(files, { level: 0 });
    onProgress({ phase: 'zip', fraction: 1 });
    return {
      blob: new Blob([bytes(zip)], { type: 'application/zip' }),
      filename: `${base}-stems.zip`,
      files: stems.length,
      seconds: stems[0].buffer.duration,
    };
  }

  const buffer = await renderArrangement(input, {
    ...renderOpts,
    onProgress: (f) => onProgress({ phase: 'render', fraction: f }),
  });
  // Copy out of the AudioBuffer so normalization doesn't touch shared memory
  const pcm: PcmAudio = { sampleRate: buffer.sampleRate, channels: audioBufferToPcm(buffer).channels.map((c) => c.slice()) };
  const levels = normalizeInPlace(pcm, s.normalize);
  const encoded = await encodeAudio(pcm, s, projectName, onProgress, signal);
  return {
    blob: new Blob([bytes(encoded)], { type: MIME[s.format] }),
    filename: `${base}.${EXT[s.format]}`,
    levels,
    seconds: buffer.duration,
  };
}

/** Export a live recording (already-captured PCM). */
export async function exportTake(
  take: PcmAudio,
  s: ExportSettings,
  name: string,
  onProgress: (p: Progress) => void,
  signal?: AbortSignal,
): Promise<ExportResult> {
  if (s.format === 'midi') throw new Error('A recording is audio — choose WAV or MP3.');
  const pcm: PcmAudio = { sampleRate: take.sampleRate, channels: take.channels.map((c) => c.slice()) };
  const levels = normalizeInPlace(pcm, s.normalize);
  const encoded = await encodeAudio(pcm, s, name, onProgress, signal);
  return {
    blob: new Blob([bytes(encoded)], { type: MIME[s.format] }),
    filename: `${safeFileName(name)}.${EXT[s.format]}`,
    levels,
    seconds: (pcm.channels[0]?.length ?? 0) / pcm.sampleRate,
  };
}

/** Peak and loudness of PCM without changing it — for the dialog's preview of a take. */
export function measure(pcm: PcmAudio): { peakDb: number; lufs: number } {
  return { peakDb: gainToDb(samplePeak(pcm)), lufs: integratedLoudness(pcm) };
}

export { RenderCancelled };
