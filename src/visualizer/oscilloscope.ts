import { computeSample, THEME_COLORS, applyDetune } from '../utils/math';
import type { OscillatorState, AdvancedSettings } from '../engine/oscillator';

const SAMPLES = 2048; // pre-allocated, reused every frame

export class Oscilloscope {
  private canvas: HTMLCanvasElement;
  private ctx2d: CanvasRenderingContext2D;
  private rafId = 0;
  private sampleBuffer = new Float32Array(SAMPLES);

  // Current render parameters (updated by setState)
  private state: OscillatorState;
  private advanced: AdvancedSettings;

  constructor(
    canvas: HTMLCanvasElement,
    state: OscillatorState,
    advanced: AdvancedSettings,
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context');
    this.ctx2d = ctx;
    this.state = state;
    this.advanced = advanced;
  }

  setState(state: OscillatorState, advanced: AdvancedSettings): void {
    this.state = state;
    this.advanced = advanced;
  }

  start(): void {
    if (this.rafId !== 0) return;
    const loop = () => {
      this.render();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private render(): void {
    const { canvas, ctx2d, sampleBuffer, state, advanced } = this;
    const W = canvas.width;
    const H = canvas.height;

    const themeColor = THEME_COLORS[advanced.colorTheme];

    // Background
    ctx2d.fillStyle = '#0a0a0a';
    ctx2d.fillRect(0, 0, W, H);

    // Grid
    if (advanced.showGrid) {
      this.drawGrid(W, H, themeColor);
    }

    // Generate waveform samples
    const effectiveFreq = applyDetune(state.frequency, advanced.centsOffset);
    const numCycles = advanced.zoomFactor;
    const duration = numCycles / effectiveFreq; // seconds to show
    const dt = duration / SAMPLES;

    for (let i = 0; i < SAMPLES; i++) {
      sampleBuffer[i] = computeSample(
        state.waveform,
        i * dt,
        effectiveFreq,
        state.amplitude,
        state.phase,
        state.pulseWidth,
      );
    }

    // Draw waveform
    ctx2d.save();
    ctx2d.strokeStyle = themeColor;
    ctx2d.lineWidth = advanced.lineThickness;
    ctx2d.lineCap = 'round';
    ctx2d.lineJoin = 'round';

    // Glow effect
    ctx2d.shadowColor = themeColor;
    ctx2d.shadowBlur = 8;

    ctx2d.beginPath();
    const padX = 40;
    const padY = 20;
    const drawW = W - 2 * padX;
    const drawH = H - 2 * padY;
    const midY = padY + drawH / 2;

    for (let i = 0; i < SAMPLES; i++) {
      const x = padX + (i / (SAMPLES - 1)) * drawW;
      const y = midY - (sampleBuffer[i] / 1.0) * (drawH / 2) * 0.9;
      if (i === 0) ctx2d.moveTo(x, y);
      else ctx2d.lineTo(x, y);
    }
    ctx2d.stroke();
    ctx2d.restore();

    // Axis labels
    this.drawLabels(W, H, duration, themeColor);
  }

  private drawGrid(W: number, H: number, themeColor: string): void {
    const ctx = this.ctx2d;
    const padX = 40;
    const padY = 20;
    const drawW = W - 2 * padX;
    const drawH = H - 2 * padY;
    const midY = padY + drawH / 2;

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;

    // Horizontal grid lines at 0, ±0.5, ±1.0
    const amplitudeLevels = [1.0, 0.5, 0.0, -0.5, -1.0];
    for (const level of amplitudeLevels) {
      const y = midY - level * (drawH / 2) * 0.9;
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(padX + drawW, y);
      // Center line slightly brighter
      ctx.strokeStyle = level === 0
        ? 'rgba(255,255,255,0.15)'
        : 'rgba(255,255,255,0.07)';
      ctx.stroke();
    }

    // Vertical grid lines (cycle divisions)
    const numCycles = this.advanced.zoomFactor;
    for (let c = 0; c <= numCycles; c++) {
      const x = padX + (c / numCycles) * drawW;
      ctx.strokeStyle = c % 1 === 0
        ? 'rgba(255,255,255,0.12)'
        : 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      ctx.moveTo(x, padY);
      ctx.lineTo(x, padY + drawH);
      ctx.stroke();
    }

    // Minor vertical divisions (half-cycle)
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    for (let c = 0; c < numCycles; c++) {
      const x = padX + ((c + 0.5) / numCycles) * drawW;
      ctx.beginPath();
      ctx.moveTo(x, padY);
      ctx.lineTo(x, padY + drawH);
      ctx.stroke();
    }

    // Border
    ctx.strokeStyle = themeColor + '33';
    ctx.lineWidth = 1;
    ctx.strokeRect(padX, padY, drawW, drawH);

    ctx.restore();
  }

  private drawLabels(W: number, H: number, duration: number, themeColor: string): void {
    const ctx = this.ctx2d;
    const padX = 40;
    const padY = 20;
    const drawW = W - 2 * padX;
    const drawH = H - 2 * padY;
    const midY = padY + drawH / 2;

    ctx.save();
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    // Y axis amplitude labels
    const amplitudeLevels: [number, string][] = [
      [1.0, '+1.0'], [0.5, '+0.5'], [0.0, '0'],
      [-0.5, '−0.5'], [-1.0, '−1.0'],
    ];
    for (const [level, label] of amplitudeLevels) {
      const y = midY - level * (drawH / 2) * 0.9;
      ctx.fillText(label, padX - 4, y);
    }

    // X axis time labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const numCycles = this.advanced.zoomFactor;
    for (let c = 0; c <= numCycles; c++) {
      const x = padX + (c / numCycles) * drawW;
      const timeMs = (duration * c / numCycles * 1000);
      const label = timeMs < 1
        ? `${(timeMs * 1000).toFixed(0)}μs`
        : `${timeMs.toFixed(2)}ms`;
      ctx.fillText(label, x, padY + drawH + 3);
    }

    // Frequency watermark
    const effectiveFreq = applyDetune(this.state.frequency, this.advanced.centsOffset);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = themeColor + '44';
    ctx.font = '11px "Courier New", monospace';
    ctx.fillText(`${effectiveFreq.toFixed(1)} Hz`, W - 6, padY + 4);

    ctx.restore();
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }
}
