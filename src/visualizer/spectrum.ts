import { getAudioEngine } from '../engine/audio';
import { getTheme, gray } from '../ui/theme';
import { canvasPixelRatio } from '../ui/scale';

// ─── Settings ─────────────────────────────────────────────────────────────────

export type VisualizerMode = 'bars' | 'wave' | 'radial' | 'bloom';

export const VISUALIZER_MODES: { id: VisualizerMode; label: string }[] = [
  { id: 'bars',   label: 'Spectrum' },
  { id: 'wave',   label: 'Waveform' },
  { id: 'radial', label: 'Radial' },
  { id: 'bloom',  label: 'Bloom' },
];

export type ColorMode = 'theme' | 'spectrum' | 'mono';

export interface VisualizerSettings {
  mode: VisualizerMode;
  colorMode: ColorMode;
  /** Input gain applied before drawing, 0.2–4. */
  sensitivity: number;
  /** Analyser time smoothing, 0–0.95. Higher is calmer. */
  smoothing: number;
  /** Bars across the width, 16–192. */
  barCount: number;
  mirror: boolean;
  glow: boolean;
  /** Motion trail, 0 = clear each frame, 0.9 = long trails. */
  trail: number;
  /** Cap the redraw rate to save battery. */
  fpsCap: 30 | 60;
}

export const DEFAULT_VISUALIZER: VisualizerSettings = {
  mode: 'bars',
  colorMode: 'theme',
  sensitivity: 1.4,
  smoothing: 0.75,
  barCount: 72,
  mirror: true,
  glow: true,
  trail: 0.25,
  fpsCap: 60,
};

// ─── Renderer ─────────────────────────────────────────────────────────────────

const FFT_SIZE = 2048;

export class Visualizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private analyser: AnalyserNode | null = null;
  private tapped: GainNode | null = null;
  private freq = new Uint8Array(FFT_SIZE / 2);
  private time = new Float32Array(FFT_SIZE);
  private rafId = 0;
  private running = false;
  private lastFrame = 0;
  private phase = 0;

  private settings: VisualizerSettings = { ...DEFAULT_VISUALIZER };
  private accent = '#00ff88';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  setSettings(s: VisualizerSettings): void {
    this.settings = s;
    if (this.analyser) this.analyser.smoothingTimeConstant = s.smoothing;
  }

  setAccent(color: string): void {
    this.accent = color;
  }

  resize(w: number, h: number): void {
    const dpr = canvasPixelRatio();
    this.canvas.width = Math.max(1, Math.floor(w * dpr));
    this.canvas.height = Math.max(1, Math.floor(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Attach to the master bus. Returns false when there is no AudioContext yet,
   * so the caller can retry once something starts playing.
   */
  private attach(): boolean {
    if (this.analyser) return true;
    const engine = getAudioEngine();
    if (engine.isRenderingOffline) return false; // never tap an export's graph
    const ctx = engine.getAudioContext();
    const master = engine.getMasterGain();
    if (!ctx || !master) return false;

    const node = ctx.createAnalyser();
    node.fftSize = FFT_SIZE;
    node.smoothingTimeConstant = this.settings.smoothing;
    master.connect(node);
    this.analyser = node;
    this.tapped = master;
    this.freq = new Uint8Array(node.frequencyBinCount);
    this.time = new Float32Array(node.fftSize);
    return true;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = 0;
    const loop = (now: number) => {
      if (!this.running) return;
      const minGap = 1000 / this.settings.fpsCap;
      if (now - this.lastFrame >= minGap) {
        this.lastFrame = now;
        this.frame();
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** Release the analyser tap. Called when the panel unmounts. */
  destroy(): void {
    this.stop();
    if (this.analyser && this.tapped) {
      try { this.tapped.disconnect(this.analyser); } catch (_) { /* ignore */ }
    }
    this.analyser = null;
    this.tapped = null;
  }

  // ─── Drawing ────────────────────────────────────────────────────────────────

  private colorFor(t: number): string {
    switch (this.settings.colorMode) {
      case 'mono':
        return gray('#d4d4d4');
      case 'spectrum':
        return `hsl(${Math.round(200 + t * 160)}, 85%, ${55 + t * 12}%)`;
      case 'theme':
      default:
        return this.accent;
    }
  }

  private frame(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const W = this.canvas.width;
    const H = this.canvas.height;

    // Trail: fade the previous frame instead of clearing it
    if (this.settings.trail > 0.01) {
      const bg = getTheme() === 'light' ? 245 : 10;
      ctx.fillStyle = `rgba(${bg}, ${bg}, ${bg}, ${1 - this.settings.trail})`;
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = gray('#0a0a0a');
      ctx.fillRect(0, 0, W, H);
    }

    if (!this.attach() || !this.analyser) {
      ctx.fillStyle = gray('#333');
      ctx.font = `${Math.round(H * 0.06)}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('press play to feed the visualizer', W / 2, H / 2);
      return;
    }

    this.analyser.getByteFrequencyData(this.freq);
    this.analyser.getFloatTimeDomainData(this.time);
    this.phase += 0.01;

    ctx.save();
    if (this.settings.glow) {
      ctx.shadowBlur = Math.max(4, H * 0.03);
    }

    switch (this.settings.mode) {
      case 'bars':   this.drawBars(ctx, W, H); break;
      case 'wave':   this.drawWave(ctx, W, H); break;
      case 'radial': this.drawRadial(ctx, W, H); break;
      case 'bloom':  this.drawBloom(ctx, W, H); break;
    }
    ctx.restore();
  }

  /** Log-spaced spectrum bars — matches how pitch is perceived. */
  private binRange(i: number, count: number): [number, number] {
    const bins = this.freq.length;
    // Only the lower ~70% of bins carry musical content at 48 kHz
    const usable = Math.floor(bins * 0.7);
    const lo = Math.floor(Math.pow(i / count, 2) * usable);
    const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / count, 2) * usable));
    return [lo, hi];
  }

  private magnitude(i: number, count: number): number {
    const [lo, hi] = this.binRange(i, count);
    let sum = 0;
    for (let b = lo; b < hi; b++) sum += this.freq[b];
    const avg = sum / (hi - lo) / 255;
    return Math.max(0, Math.min(1, avg * this.settings.sensitivity));
  }

  private drawBars(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const count = this.settings.barCount;
    const gap = Math.max(1, W / count * 0.18);
    const bw = (W / count) - gap;
    const baseY = this.settings.mirror ? H / 2 : H;
    const maxH = this.settings.mirror ? H / 2 : H;

    for (let i = 0; i < count; i++) {
      const m = this.magnitude(i, count);
      const h = Math.pow(m, 0.8) * maxH;
      const x = i * (bw + gap) + gap / 2;
      const color = this.colorFor(i / count);
      ctx.fillStyle = color;
      if (this.settings.glow) ctx.shadowColor = color;
      ctx.fillRect(x, baseY - h, bw, h);
      if (this.settings.mirror) ctx.fillRect(x, baseY, bw, h * 0.6);
    }
  }

  private drawWave(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const data = this.time;
    const mid = H / 2;
    const amp = mid * 0.9 * this.settings.sensitivity;
    const color = this.colorFor(0.5);

    ctx.strokeStyle = color;
    if (this.settings.glow) ctx.shadowColor = color;
    ctx.lineWidth = Math.max(1.5, H * 0.008);
    ctx.beginPath();
    const step = Math.max(1, Math.floor(data.length / W));
    for (let i = 0, x = 0; i < data.length; i += step, x++) {
      const y = mid - data[i] * amp;
      if (x === 0) ctx.moveTo(0, y); else ctx.lineTo(x * (W / (data.length / step)), y);
    }
    ctx.stroke();

    if (this.settings.mirror) {
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      for (let i = 0, x = 0; i < data.length; i += step, x++) {
        const y = mid + data[i] * amp;
        if (x === 0) ctx.moveTo(0, y); else ctx.lineTo(x * (W / (data.length / step)), y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawRadial(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const count = this.settings.barCount;
    const cx = W / 2;
    const cy = H / 2;
    const inner = Math.min(W, H) * 0.16;
    const reach = Math.min(W, H) * 0.32;
    const sweep = this.settings.mirror ? Math.PI : Math.PI * 2;

    ctx.lineWidth = Math.max(1.5, (Math.min(W, H) * 0.9) / count);
    for (let i = 0; i < count; i++) {
      const m = this.magnitude(i, count);
      const len = inner + Math.pow(m, 0.8) * reach;
      const a = (i / count) * sweep - Math.PI / 2 + this.phase * 0.2;
      const color = this.colorFor(i / count);
      ctx.strokeStyle = color;
      if (this.settings.glow) ctx.shadowColor = color;

      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      ctx.stroke();

      if (this.settings.mirror) {
        const a2 = -a - Math.PI;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a2) * inner, cy + Math.sin(a2) * inner);
        ctx.lineTo(cx + Math.cos(a2) * len, cy + Math.sin(a2) * len);
        ctx.stroke();
      }
    }
  }

  /** Concentric rings whose radius tracks a frequency band — a soft, slow mode. */
  private drawBloom(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const cx = W / 2;
    const cy = H / 2;
    const rings = Math.max(4, Math.min(28, Math.floor(this.settings.barCount / 4)));
    const unit = Math.min(W, H) * 0.46;

    for (let i = rings - 1; i >= 0; i--) {
      const m = this.magnitude(i, rings);
      const r = unit * ((i + 1) / rings) * (0.55 + m * 0.75);
      const color = this.colorFor(i / rings);
      ctx.strokeStyle = color;
      if (this.settings.glow) ctx.shadowColor = color;
      ctx.globalAlpha = 0.25 + m * 0.65;
      ctx.lineWidth = Math.max(1, unit * 0.012 + m * unit * 0.02);
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, r), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
