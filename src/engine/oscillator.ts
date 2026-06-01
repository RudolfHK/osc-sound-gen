import type { ColorTheme } from '../utils/math';
import type { Waveform } from '../utils/math';
import type { SequencerState } from '../utils/music';

// ─── Existing types (unchanged) ──────────────────────────────────────────────

export interface OscillatorState {
  waveform: Waveform;
  frequency: number;    // Hz, 20–20000
  amplitude: number;    // 0.0–1.0
  phase: number;        // radians, 0–2π
  pulseWidth: number;   // 0.01–0.99 (square only)
  masterVolume: number; // 0.0–1.0 — repurposed as per-tab level in multi-tab mode
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

// ─── Multi-tab types (new) ────────────────────────────────────────────────────

export interface OscillatorTab {
  id: string;
  label: string;
  color: string;          // accent color for tab indicator + oscilloscope waveform
  oscillator: OscillatorState;
  advanced: AdvancedSettings;
  isPlaying: boolean;
  isMuted: boolean;
  solo: boolean;
}

export interface AppState {
  tabs: OscillatorTab[];
  activeTabId: string;
  masterVolume: number;   // global master gain applied after all tab gains mix
  isRecording: boolean;
  overlayMode: boolean;   // false = single active tab, true = all tabs on same canvas
  sequencer: SequencerState;
}
