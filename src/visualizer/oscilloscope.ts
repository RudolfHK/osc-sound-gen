import { computeSample, applyDetune } from '../utils/math';
import type { OscillatorState, AdvancedSettings } from '../engine/oscillator';

const SAMPLES = 2048; // pre-allocated, reused every frame

// Data needed to render a single tab waveform in overlay mode
export interface TabRenderInfo {
  id: string;
  label: string;
  color: string;
  oscillator: OscillatorState;
  advanced: AdvancedSettings;
  isMuted: boolean;
  isActive: boolean;
}

export class Oscilloscope {
  private canvas: HTMLCanvasElement;
  private ctx2d: CanvasRenderingContext2D;
  private rafId = 0;

  // Pre-allocated buffers — never allocate inside the render loop
  private sampleBuffer = new Float32Array(SAMPLES);
  private sumBuffer = new Float32Array(SAMPLES);
  private perTabBuffer = new Float32Array(SAMPLES);

  // Single-mode state
  private state: OscillatorState;
  private advanced: AdvancedSettings;
  private singleColor: string;

  // Overlay-mode state
  private overlayMode = false;
  private tabs: TabRenderInfo[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    state: OscillatorState,
    advanced: AdvancedSettings,
    color = '#00ff88',
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context');
    this.ctx2d = ctx;
    this.state = state;
    this.advanced = advanced;
    this.singleColor = color;
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /** Update single-mode parameters each frame (or whenever state changes). */
  setState(state: OscillatorState, advanced: AdvancedSettings, color?: string): void {
    this.state = state;
    this.advanced = advanced;
    if (color !== undefined) this.singleColor = color;
  }

  setOverlayMode(overlay: boolean): void {
    this.overlayMode = overlay;
  }

  setTabs(tabs: TabRenderInfo[]): void {
    this.tabs = tabs;
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

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  // ─── Render dispatch ─────────────────────────────────────────────────────────

  private render(): void {
    if (this.overlayMode && this.tabs.length > 0) {
      this.renderOverlay();
    } else {
      this.renderSingle();
    }
  }

  // ─── Single-mode render (original behavior) ───────────────────────────────────

  private renderSingle(): void {
    const { canvas, ctx2d, sampleBuffer, state, advanced } = this;
    const W = canvas.width;
    const H = canvas.height;
    const color = this.singleColor;

    ctx2d.fillStyle = '#0a0a0a';
    ctx2d.fillRect(0, 0, W, H);

    if (advanced.showGrid) this.drawGrid(W, H, color, advanced.zoomFactor);

    const effectiveFreq = applyDetune(state.frequency, advanced.centsOffset);
    const duration = advanced.zoomFactor / effectiveFreq;
    const dt = duration / SAMPLES;

    for (let i = 0; i < SAMPLES; i++) {
      sampleBuffer[i] = computeSample(
        state.waveform, i * dt, effectiveFreq, state.amplitude, state.phase, state.pulseWidth,
      );
    }

    this.drawWaveformPath(sampleBuffer, W, H, color, advanced.lineThickness, 1.0);
    this.drawLabels(W, H, duration, color, advanced.zoomFactor, effectiveFreq);
  }

  // ─── Overlay-mode render ──────────────────────────────────────────────────────

  private renderOverlay(): void {
    const { canvas, ctx2d, sumBuffer, perTabBuffer } = this;
    const W = canvas.width;
    const H = canvas.height;

    // Use active tab's advanced settings for grid/zoom
    const activeTab = this.tabs.find((t) => t.isActive) ?? this.tabs[0];
    const adv = activeTab.advanced;

    ctx2d.fillStyle = '#0a0a0a';
    ctx2d.fillRect(0, 0, W, H);

    if (adv.showGrid) this.drawGrid(W, H, '#ffffff', adv.zoomFactor);

    // Reset sum buffer
    sumBuffer.fill(0);

    // Reference frequency from active tab (governs the time window)
    const refFreq = applyDetune(activeTab.oscillator.frequency, adv.centsOffset);
    const duration = adv.zoomFactor / refFreq;
    const dt = duration / SAMPLES;

    // Draw each tab waveform, accumulate sum for non-muted tabs
    for (const tab of this.tabs) {
      const freq = applyDetune(tab.oscillator.frequency, tab.advanced.centsOffset);
      for (let i = 0; i < SAMPLES; i++) {
        perTabBuffer[i] = computeSample(
          tab.oscillator.waveform,
          i * dt,
          freq,
          tab.oscillator.amplitude,
          tab.oscillator.phase,
          tab.oscillator.pulseWidth,
        );
        if (!tab.isMuted) {
          sumBuffer[i] += perTabBuffer[i];
        }
      }

      const opacity = tab.isMuted ? 0.18 : (tab.isActive ? 1.0 : 0.6);
      const thickness = tab.isActive ? adv.lineThickness : Math.max(1, adv.lineThickness - 0.5);
      this.drawWaveformPath(perTabBuffer, W, H, tab.color, thickness, opacity);
    }

    // Clamp sum to [-1, 1] and draw in white on top
    for (let i = 0; i < SAMPLES; i++) {
      sumBuffer[i] = Math.max(-1, Math.min(1, sumBuffer[i]));
    }
    this.drawWaveformPath(sumBuffer, W, H, 'rgba(255,255,255,0.85)', adv.lineThickness, 1.0);

    this.drawLabels(W, H, duration, '#ffffff', adv.zoomFactor, refFreq);
    this.drawOverlayLegend(W);
  }

  // ─── Drawing helpers ─────────────────────────────────────────────────────────

  private drawWaveformPath(
    buffer: Float32Array,
    W: number,
    H: number,
    color: string,
    lineWidth: number,
    opacity: number,
  ): void {
    const ctx = this.ctx2d;
    const padX = 40;
    const padY = 20;
    const drawW = W - 2 * padX;
    const drawH = H - 2 * padY;
    const midY = padY + drawH / 2;

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;

    ctx.beginPath();
    for (let i = 0; i < SAMPLES; i++) {
      const x = padX + (i / (SAMPLES - 1)) * drawW;
      const y = midY - buffer[i] * (drawH / 2) * 0.9;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawGrid(W: number, H: number, accentColor: string, numCycles: number): void {
    const ctx = this.ctx2d;
    const padX = 40;
    const padY = 20;
    const drawW = W - 2 * padX;
    const drawH = H - 2 * padY;
    const midY = padY + drawH / 2;

    ctx.save();
    ctx.lineWidth = 1;

    const levels = [1.0, 0.5, 0.0, -0.5, -1.0];
    for (const level of levels) {
      const y = midY - level * (drawH / 2) * 0.9;
      ctx.strokeStyle = level === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(padX + drawW, y);
      ctx.stroke();
    }

    for (let c = 0; c <= numCycles; c++) {
      const x = padX + (c / numCycles) * drawW;
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath(); ctx.moveTo(x, padY); ctx.lineTo(x, padY + drawH); ctx.stroke();
    }
    for (let c = 0; c < numCycles; c++) {
      const x = padX + ((c + 0.5) / numCycles) * drawW;
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.beginPath(); ctx.moveTo(x, padY); ctx.lineTo(x, padY + drawH); ctx.stroke();
    }

    ctx.strokeStyle = accentColor + '33';
    ctx.strokeRect(padX, padY, drawW, drawH);
    ctx.restore();
  }

  private drawLabels(
    W: number, H: number, duration: number,
    accentColor: string, numCycles: number, effectiveFreq: number,
  ): void {
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

    const amplitudeLevels: [number, string][] = [
      [1.0, '+1.0'], [0.5, '+0.5'], [0.0, '0'], [-0.5, '−0.5'], [-1.0, '−1.0'],
    ];
    for (const [level, label] of amplitudeLevels) {
      const y = midY - level * (drawH / 2) * 0.9;
      ctx.fillText(label, padX - 4, y);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let c = 0; c <= numCycles; c++) {
      const x = padX + (c / numCycles) * drawW;
      const timeMs = (duration * c / numCycles) * 1000;
      const label = timeMs < 1
        ? `${(timeMs * 1000).toFixed(0)}μs`
        : `${timeMs.toFixed(2)}ms`;
      ctx.fillText(label, x, padY + drawH + 3);
    }

    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = accentColor + '44';
    ctx.font = '11px "Courier New", monospace';
    ctx.fillText(`${effectiveFreq.toFixed(1)} Hz`, W - 6, padY + 4);
    ctx.restore();
  }

  private drawOverlayLegend(W: number): void {
    const ctx = this.ctx2d;
    const padY = 24;
    const lineH = 16;
    const boxPad = 6;
    const count = this.tabs.length + 1; // +1 for SUM
    const boxH = count * lineH + boxPad * 2;
    const boxW = 100;
    const bx = W - 44 - boxW;
    const by = padY + 20;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bx, by, boxW, boxH);

    ctx.font = '9px "Courier New", monospace';
    ctx.textBaseline = 'middle';

    let row = 0;
    for (const tab of this.tabs) {
      const y = by + boxPad + row * lineH + lineH / 2;
      ctx.fillStyle = tab.isMuted ? tab.color + '44' : tab.color;
      ctx.fillRect(bx + 6, y - 4, 8, 8);
      ctx.fillStyle = tab.isMuted ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.8)';
      ctx.fillText(tab.label, bx + 20, y);
      row++;
    }

    // SUM row
    const sumY = by + boxPad + row * lineH + lineH / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(bx + 6, sumY - 4, 8, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('SUM', bx + 20, sumY);

    ctx.restore();
  }
}
