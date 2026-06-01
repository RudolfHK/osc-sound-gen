import type { Waveform, ColorTheme } from '../utils/math';

export interface OscillatorState {
  waveform: Waveform;
  frequency: number;   // Hz, 20–20000
  amplitude: number;   // 0.0–1.0
  phase: number;       // radians, 0–2π
  pulseWidth: number;  // 0.01–0.99 (square only)
  masterVolume: number; // 0.0–1.0
  isPlaying: boolean;
}

export interface AdvancedSettings {
  centsOffset: number;    // -100 to +100
  zoomFactor: number;     // 1–8 (cycles shown in oscilloscope)
  lineThickness: number;  // 1–4 px
  colorTheme: ColorTheme;
  showGrid: boolean;
}

export const DEFAULT_STATE: OscillatorState = {
  waveform: 'sine',
  frequency: 440,
  amplitude: 0.8,
  phase: 0,
  pulseWidth: 0.5,
  masterVolume: 0.7,
  isPlaying: false,
};

export const DEFAULT_ADVANCED: AdvancedSettings = {
  centsOffset: 0,
  zoomFactor: 2,
  lineThickness: 2,
  colorTheme: 'green',
  showGrid: true,
};
