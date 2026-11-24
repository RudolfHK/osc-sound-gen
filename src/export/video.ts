/**
 * Video export: the song with a visualizer, its title, the section playing
 * and a progress bar — for sharing where audio files can't go.
 *
 * The audio is rendered offline first (the same render as a WAV export),
 * then played in real time through a private audio context — never the live
 * engine — into a canvas stream recorded by MediaRecorder. MP4 (H.264/AAC)
 * where the browser can record it, otherwise WebM (VP9 or VP8/Opus). No
 * encoder library, no upload.
 */
import { Visualizer, DEFAULT_VISUALIZER, type VisualizerMode } from '../visualizer/spectrum';
import { getTheme } from '../ui/theme';
import { RenderCancelled } from './render';
import type { PcmAudio } from './wav';

export type VideoAspect = '16:9' | '1:1' | '9:16';

export const VIDEO_ASPECTS: { id: VideoAspect; label: string; hint: string }[] = [
  { id: '16:9', label: '16:9', hint: 'YouTube, a laptop screen' },
  { id: '1:1', label: '1:1', hint: 'Square feeds' },
  { id: '9:16', label: '9:16', hint: 'Phones: Shorts, Reels, TikTok' },
];

export const VIDEO_SIZES: Record<VideoAspect, [number, number]> = {
  '16:9': [1280, 720],
  '1:1': [1080, 1080],
  '9:16': [720, 1280],
};

export interface VideoFormat { mime: string; ext: 'mp4' | 'webm'; label: string }

const CANDIDATES: VideoFormat[] = [
  { mime: 'video/mp4;codecs=avc1.42E01F,mp4a.40.2', ext: 'mp4', label: 'MP4 (H.264, AAC)' },
  { mime: 'video/mp4;codecs=avc1.42E01F,opus', ext: 'mp4', label: 'MP4 (H.264, Opus)' },
  { mime: 'video/webm;codecs=vp9,opus', ext: 'webm', label: 'WebM (VP9, Opus)' },
  { mime: 'video/webm;codecs=vp8,opus', ext: 'webm', label: 'WebM (VP8, Opus)' },
  { mime: 'video/webm', ext: 'webm', label: 'WebM' },
];

/** The best format this browser can record, or null if it can't record video. */
export function pickVideoFormat(
  supported: (mime: string) => boolean = (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
): VideoFormat | null {
  return CANDIDATES.find((c) => supported(c.mime)) ?? null;
}

interface Box { x: number; y: number; w: number; h: number }

/**
 * Where things go in a frame of this size: the visual in the middle, the
 * title above it (below it on a wide frame), the progress bar at the bottom.
 * Sizes scale with the frame's short side, so all three aspects read alike.
 */
export function videoLayout(w: number, h: number): {
  viz: Box; title: { x: number; y: number; size: number }; sub: { x: number; y: number; size: number };
  bar: Box; time: { y: number; size: number }; pad: number;
} {
  const u = Math.min(w, h);
  const pad = Math.round(u * 0.06);
  const titleSize = Math.round(u * 0.065);
  const subSize = Math.round(u * 0.032);
  const barH = Math.max(4, Math.round(u * 0.008));
  const timeSize = Math.round(u * 0.028);
  const barY = h - pad - barH;
  const timeY = barY - Math.round(timeSize * 0.5);
  const titleY = pad + titleSize;
  const subY = titleY + Math.round(subSize * 1.6);
  const vizTop = subY + Math.round(u * 0.05);
  const vizBottom = timeY - Math.round(timeSize * 1.8);
  return {
    pad,
    title: { x: pad, y: titleY, size: titleSize },
    sub: { x: pad, y: subY, size: subSize },
    viz: { x: pad, y: vizTop, w: w - 2 * pad, h: Math.max(10, vizBottom - vizTop) },
    bar: { x: pad, y: barY, w: w - 2 * pad, h: barH },
    time: { y: timeY, size: timeSize },
  };
}

export const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** The section playing at `seconds` into the video. */
export function sectionAt(sections: { name: string; seconds: number }[], seconds: number): string {
  let name = '';
  for (const s of sections) if (s.seconds <= seconds + 1e-6) name = s.name;
  return name;
}

export interface VideoOptions {
  aspect: VideoAspect;
  style: VisualizerMode;
  title: string;
  /** Section starts, in seconds from the start of the video. */
  sections: { name: string; seconds: number }[];
  accent: string;
  format: VideoFormat;
  /** Also play it through the speakers while it records. */
  listen?: boolean;
  onProgress: (fraction: number) => void;
  signal?: AbortSignal;
}

const FPS = 30;

/** Record `audio` as a video. Takes as long as the audio lasts. */
export async function recordVideo(audio: PcmAudio, o: VideoOptions): Promise<Blob> {
  const [W, H] = VIDEO_SIZES[o.aspect];
  const frames = audio.channels[0]?.length ?? 0;
  const duration = frames / audio.sampleRate;
  if (duration <= 0) throw new Error('Nothing to record: the range is silent.');

  const ctx = new AudioContext({ sampleRate: audio.sampleRate });
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  if (!g) { void ctx.close(); throw new Error('This browser can\'t draw video frames.'); }

  const buffer = ctx.createBuffer(Math.max(1, audio.channels.length), frames, audio.sampleRate);
  audio.channels.forEach((ch, i) => buffer.copyToChannel(ch as Float32Array<ArrayBuffer>, i));
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  const dest = ctx.createMediaStreamDestination();
  source.connect(analyser);
  source.connect(dest);
  if (o.listen) source.connect(ctx.destination);

  // The visualizer draws into its own canvas, placed into each frame
  const L = videoLayout(W, H);
  const vizCanvas = document.createElement('canvas');
  const viz = new Visualizer(vizCanvas);
  viz.setSettings({ ...DEFAULT_VISUALIZER, mode: o.style });
  viz.setAccent(o.accent);
  viz.setPixelSize(L.viz.w, L.viz.h);
  viz.useAnalyser(analyser);

  const light = getTheme() === 'light';
  const bg = light ? '#f5f5f5' : '#0a0a0a';
  const ink = light ? '#171717' : '#f5f5f5';
  const dim = light ? '#737373' : '#8a8a8a';
  const track = light ? '#d4d4d4' : '#262626';
  const font = getComputedStyle(document.body).fontFamily || 'ui-monospace, monospace';

  const draw = (t: number) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    viz.renderFrame();
    g.drawImage(vizCanvas, L.viz.x, L.viz.y, L.viz.w, L.viz.h);
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.fillStyle = ink;
    g.font = `bold ${L.title.size}px ${font}`;
    g.fillText(o.title, L.title.x, L.title.y, W - 2 * L.pad);
    const section = sectionAt(o.sections, t);
    if (section) {
      g.fillStyle = o.accent;
      g.font = `${L.sub.size}px ${font}`;
      g.fillText(section.toUpperCase(), L.sub.x, L.sub.y, W - 2 * L.pad);
    }
    g.fillStyle = track;
    g.fillRect(L.bar.x, L.bar.y, L.bar.w, L.bar.h);
    g.fillStyle = o.accent;
    g.fillRect(L.bar.x, L.bar.y, L.bar.w * Math.min(1, t / duration), L.bar.h);
    g.fillStyle = dim;
    g.font = `${L.time.size}px ${font}`;
    g.fillText(clock(t), L.bar.x, L.time.y);
    g.textAlign = 'right';
    g.fillText(clock(duration), L.bar.x + L.bar.w, L.time.y);
  };

  const video = canvas.captureStream(FPS);
  const stream = new MediaStream([...video.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const recorder = new MediaRecorder(stream, {
    mimeType: o.format.mime,
    videoBitsPerSecond: W * H >= 1080 * 1080 ? 6_000_000 : 4_500_000,
    audioBitsPerSecond: 192_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  const cleanup = () => {
    for (const tr of stream.getTracks()) tr.stop();
    try { source.stop(); } catch { /* not started */ }
    viz.destroy();
    void ctx.close();
  };

  try {
    await ctx.resume();
    draw(0);
    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
    recorder.start(1000);
    const t0 = ctx.currentTime + 0.15;
    source.start(t0);

    await new Promise<void>((resolve, reject) => {
      let raf = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const done = (err?: unknown) => {
        cancelAnimationFrame(raf);
        if (timer) clearTimeout(timer);
        o.signal?.removeEventListener('abort', abort);
        if (err) reject(err); else resolve();
      };
      const abort = () => done(new RenderCancelled());
      o.signal?.addEventListener('abort', abort);
      // Frames follow the audio clock. A hidden tab gets no animation frames,
      // so a timer keeps the picture moving (slower) until it's visible again.
      const tick = () => {
        const t = ctx.currentTime - t0;
        draw(Math.max(0, t));
        o.onProgress(Math.max(0, Math.min(1, t / duration)));
        if (t >= duration + 0.25) { done(); return; }
        if (document.hidden) timer = setTimeout(tick, 1000 / FPS);
        else raf = requestAnimationFrame(tick);
      };
      tick();
    });

    recorder.stop();
    await stopped;
    return new Blob(chunks, { type: o.format.mime.split(';')[0] });
  } catch (err) {
    if (recorder.state !== 'inactive') recorder.stop();
    throw err;
  } finally {
    cleanup();
  }
}
