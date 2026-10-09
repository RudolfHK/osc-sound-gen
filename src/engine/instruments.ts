import { getAudioEngine, applyWaveformToNode } from './audio';
import { getEffectsBus } from './effects';
import { getChannelRack } from './channelStrip';
import { findLane, laneRealAt, scheduleLaneOnParam } from './automation';
import { noiseSource, startNoise } from './sampler';
import { VoicePool } from './voices';
import { midiToFreq } from '../utils/music';
import type { AutomationLane, InstrumentPatch } from '../utils/music';
import type { OscillatorState, AdvancedSettings } from './oscillator';

// ─── Types ────────────────────────────────────────────────────────────────────

export type InstrumentCategory =
  | 'Piano' | 'Keys' | 'Organ'
  | 'Synth Lead' | 'Synth Pad' | 'Synth Bass' | 'Synth Pluck'
  | 'Electric Guitar' | 'Acoustic Guitar' | 'Bass Guitar'
  | 'Strings' | 'Brass' | 'Woodwind'
  | 'Mallets' | 'Plucked' | 'Vocal' | 'World' | 'FX';

export const CATEGORIES: InstrumentCategory[] = [
  'Piano', 'Keys', 'Organ',
  'Synth Lead', 'Synth Pad', 'Synth Bass', 'Synth Pluck',
  'Electric Guitar', 'Acoustic Guitar', 'Bass Guitar',
  'Strings', 'Brass', 'Woodwind',
  'Mallets', 'Plucked', 'Vocal', 'World', 'FX',
];

export const CATEGORY_COLORS: Record<InstrumentCategory, string> = {
  'Piano':           '#fbbf24',
  'Keys':            '#eab308',
  'Organ':           '#d97706',
  'Synth Lead':      '#f43f5e',
  'Synth Pad':       '#8b5cf6',
  'Synth Bass':      '#3b82f6',
  'Synth Pluck':     '#0ea5e9',
  'Electric Guitar': '#ef4444',
  'Acoustic Guitar': '#f97316',
  'Bass Guitar':     '#06b6d4',
  'Strings':         '#a855f7',
  'Brass':           '#f59e0b',
  'Woodwind':        '#14b8a6',
  'Mallets':         '#84cc16',
  'Plucked':         '#22c55e',
  'Vocal':           '#ec4899',
  'World':           '#78716c',
  'FX':              '#64748b',
};

/** One oscillator inside a preset's stack. */
export interface OscLayer {
  wave: OscillatorType;
  detune: number;   // cents
  octave: number;   // semitone offset / 12
  gain: number;     // 0–1
}

export interface ADSR {
  attack: number;
  decay: number;
  sustain: number;  // 0–1
  release: number;
}

export interface SendLevels {
  reverb: number;
  delay: number;
  chorus: number;
}

export interface InstrumentPreset {
  id: string;
  name: string;
  category: InstrumentCategory;
  color: string;
  layers: OscLayer[];
  filter: {
    type: BiquadFilterType;
    cutoff: number;      // Hz
    q: number;
    envAmount: number;   // 0 = static; 1+ opens the filter on attack
    envDecay: number;    // seconds for the filter sweep
    keyTrack: number;    // 0 = fixed cutoff, 1 = follows pitch
    velTrack: number;    // 0 = velocity only changes level, 1 = hard hits open up
  };
  amp: ADSR;
  /** Body/formant resonance — gives acoustic instruments their character. */
  body: { freq: number; gain: number; q: number } | null;
  drive: number;        // 0–1 waveshaper amount
  noise: number;        // 0–1 pick/breath transient level
  noiseDecay: number;   // seconds
  noiseFreq: number;    // Hz, bandpass centre of the transient
  vibrato: { rate: number; depth: number };  // depth in cents
  /** Per-note random detune and level variation — 0 for machines, up for acoustics. */
  humanize: number;     // 0–1
  /** Stereo spread across the oscillator stack. */
  width: number;        // 0–1
  send: SendLevels;
  volume: number;
  pan: number;
  octave: number;       // transpose in octaves
  glide: number;        // portamento seconds
}

/** User-adjustable overrides layered on top of a preset (library-wide or per track). */
export type InstrumentOverride = InstrumentPatch;

export const OVERRIDE_FIELDS: {
  key: keyof InstrumentOverride; label: string; group: 'TONE' | 'ENVELOPE' | 'MIX';
  min: number; max: number; step: number;
  from: (p: InstrumentPreset) => number;
  format: (v: number) => string;
}[] = [
  { key: 'attack',     label: 'ATTACK',  group: 'ENVELOPE', min: 0.001, max: 2,     step: 0.001, from: (p) => p.amp.attack,    format: (v) => `${Math.round(v * 1000)}ms` },
  { key: 'decay',      label: 'DECAY',   group: 'ENVELOPE', min: 0.01,  max: 4,     step: 0.01,  from: (p) => p.amp.decay,     format: (v) => `${v.toFixed(2)}s` },
  { key: 'sustain',    label: 'SUSTAIN', group: 'ENVELOPE', min: 0,     max: 1,     step: 0.01,  from: (p) => p.amp.sustain,   format: (v) => `${Math.round(v * 100)}` },
  { key: 'release',    label: 'RELEASE', group: 'ENVELOPE', min: 0.01,  max: 4,     step: 0.01,  from: (p) => p.amp.release,   format: (v) => `${v.toFixed(2)}s` },
  { key: 'cutoff',     label: 'CUTOFF',  group: 'TONE',     min: 80,    max: 16000, step: 10,    from: (p) => p.filter.cutoff, format: (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}` },
  { key: 'resonance',  label: 'RESO',    group: 'TONE',     min: 0.1,   max: 20,    step: 0.1,   from: (p) => p.filter.q,      format: (v) => v.toFixed(1) },
  { key: 'drive',      label: 'DRIVE',   group: 'TONE',     min: 0,     max: 1,     step: 0.01,  from: (p) => p.drive,         format: (v) => `${Math.round(v * 100)}` },
  { key: 'detune',     label: 'DETUNE',  group: 'TONE',     min: 0,     max: 50,    step: 1,     from: () => 0,                format: (v) => `${Math.round(v)}c` },
  { key: 'octave',     label: 'OCTAVE',  group: 'TONE',     min: -2,    max: 2,     step: 1,     from: (p) => p.octave,        format: (v) => v > 0 ? `+${v}` : `${v}` },
  { key: 'glide',      label: 'GLIDE',   group: 'TONE',     min: 0,     max: 0.5,   step: 0.005, from: (p) => p.glide,         format: (v) => `${Math.round(v * 1000)}ms` },
  { key: 'volume',     label: 'VOLUME',  group: 'MIX',      min: 0,     max: 1,     step: 0.01,  from: (p) => p.volume,        format: (v) => `${Math.round(v * 100)}` },
  { key: 'pan',        label: 'PAN',     group: 'MIX',      min: -1,    max: 1,     step: 0.01,  from: (p) => p.pan,           format: (v) => v === 0 ? 'C' : v > 0 ? `R${Math.round(v * 100)}` : `L${Math.round(-v * 100)}` },
  { key: 'width',      label: 'WIDTH',   group: 'MIX',      min: 0,     max: 1,     step: 0.01,  from: (p) => p.width,         format: (v) => `${Math.round(v * 100)}` },
  { key: 'reverbSend', label: 'REVERB',  group: 'MIX',      min: 0,     max: 1,     step: 0.01,  from: (p) => p.send.reverb,   format: (v) => `${Math.round(v * 100)}` },
  { key: 'delaySend',  label: 'DELAY',   group: 'MIX',      min: 0,     max: 1,     step: 0.01,  from: (p) => p.send.delay,    format: (v) => `${Math.round(v * 100)}` },
  { key: 'chorusSend', label: 'CHORUS',  group: 'MIX',      min: 0,     max: 1,     step: 0.01,  from: (p) => p.send.chorus,   format: (v) => `${Math.round(v * 100)}` },
];

// ─── Preset builder ───────────────────────────────────────────────────────────

type PresetSpec =
  Partial<Omit<InstrumentPreset, 'id' | 'name' | 'category' | 'color' | 'send' | 'filter'>> & {
    /** Only the sends that differ from the defaults need listing. */
    send?: Partial<SendLevels>;
    filter?: Partial<InstrumentPreset['filter']>;
  };

function P(
  id: string, name: string, category: InstrumentCategory, spec: PresetSpec,
): InstrumentPreset {
  return {
    id, name, category,
    color: CATEGORY_COLORS[category],
    layers: [{ wave: 'sawtooth', detune: 0, octave: 0, gain: 1 }],
    body: null,
    drive: 0,
    noise: 0, noiseDecay: 0.03, noiseFreq: 2500,
    vibrato: { rate: 0, depth: 0 },
    humanize: 0, width: 0,
    volume: 0.8, pan: 0, octave: 0, glide: 0,
    ...spec,
    filter: {
      type: 'lowpass', cutoff: 6000, q: 0.7,
      envAmount: 0, envDecay: 0.3, keyTrack: 0, velTrack: 0.3,
      ...spec.filter,
    },
    amp: spec.amp ?? { attack: 0.005, decay: 0.2, sustain: 0.7, release: 0.25 },
    send: { reverb: 0.16, delay: 0, chorus: 0, ...spec.send },
  };
}

// ─── Preset library ───────────────────────────────────────────────────────────

export const INSTRUMENT_PRESETS: InstrumentPreset[] = [
  // ══ Piano ═══════════════════════════════════════════════════════════════════
  P('piano-grand', 'Grand Piano', 'Piano', {
    layers: [
      { wave: 'triangle', detune: 0, octave: 0, gain: 1 },
      { wave: 'sine', detune: 1, octave: 1, gain: 0.4 },
      { wave: 'sawtooth', detune: -2, octave: 0, gain: 0.16 },
      { wave: 'sine', detune: 3, octave: 2, gain: 0.09 },
    ],
    filter: { type: 'lowpass', cutoff: 3600, q: 0.9, envAmount: 2.4, envDecay: 0.2, keyTrack: 0.6, velTrack: 0.8 },
    body: { freq: 500, gain: 5, q: 0.9 },
    amp: { attack: 0.002, decay: 2.4, sustain: 0.1, release: 0.6 },
    noise: 0.22, noiseDecay: 0.012, noiseFreq: 2600,
    humanize: 0.14, width: 0.25, send: { reverb: 0.24 }, volume: 0.78,
  }),
  P('piano-bright', 'Bright Piano', 'Piano', {
    layers: [
      { wave: 'triangle', detune: 0, octave: 0, gain: 0.9 },
      { wave: 'sawtooth', detune: 2, octave: 0, gain: 0.3 },
      { wave: 'sine', detune: -1, octave: 1, gain: 0.5 },
      { wave: 'sine', detune: 4, octave: 2, gain: 0.16 },
    ],
    filter: { type: 'lowpass', cutoff: 5200, q: 1.1, envAmount: 2.6, envDecay: 0.18, keyTrack: 0.6, velTrack: 0.9 },
    body: { freq: 1600, gain: 5, q: 1.2 },
    amp: { attack: 0.002, decay: 2, sustain: 0.09, release: 0.5 },
    noise: 0.3, noiseDecay: 0.011, noiseFreq: 3600,
    humanize: 0.13, width: 0.28, send: { reverb: 0.22 }, volume: 0.75,
  }),
  P('piano-upright', 'Upright Piano', 'Piano', {
    layers: [
      { wave: 'triangle', detune: 0, octave: 0, gain: 1 },
      { wave: 'sine', detune: 5, octave: 1, gain: 0.3 },
      { wave: 'sawtooth', detune: -4, octave: 0, gain: 0.14 },
    ],
    filter: { type: 'lowpass', cutoff: 2800, q: 1, envAmount: 2, envDecay: 0.2, keyTrack: 0.55, velTrack: 0.75 },
    body: { freq: 380, gain: 6, q: 1.1 },
    amp: { attack: 0.003, decay: 1.9, sustain: 0.1, release: 0.5 },
    noise: 0.26, noiseDecay: 0.014, noiseFreq: 2200,
    humanize: 0.2, width: 0.18, send: { reverb: 0.2 }, volume: 0.78,
  }),
  P('piano-honky', 'Honky-Tonk', 'Piano', {
    layers: [
      { wave: 'triangle', detune: -14, octave: 0, gain: 0.8 },
      { wave: 'triangle', detune: 15, octave: 0, gain: 0.8 },
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 0.2 },
      { wave: 'sine', detune: 9, octave: 1, gain: 0.3 },
    ],
    filter: { type: 'lowpass', cutoff: 3400, q: 1.2, envAmount: 2.2, envDecay: 0.16, keyTrack: 0.55, velTrack: 0.8 },
    body: { freq: 900, gain: 7, q: 1.4 },
    amp: { attack: 0.002, decay: 1.5, sustain: 0.08, release: 0.4 },
    noise: 0.3, noiseDecay: 0.012, noiseFreq: 3000,
    humanize: 0.3, width: 0.35, send: { reverb: 0.16 }, volume: 0.7,
  }),
  P('piano-felt', 'Felt Piano', 'Piano', {
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'triangle', detune: 3, octave: 0, gain: 0.4 },
      { wave: 'sine', detune: -3, octave: 1, gain: 0.2 },
    ],
    filter: { type: 'lowpass', cutoff: 1500, q: 0.8, envAmount: 1.2, envDecay: 0.25, keyTrack: 0.5, velTrack: 0.55 },
    body: { freq: 420, gain: 4, q: 0.9 },
    amp: { attack: 0.012, decay: 2.6, sustain: 0.12, release: 0.9 },
    noise: 0.14, noiseDecay: 0.03, noiseFreq: 1400,
    humanize: 0.16, width: 0.3, send: { reverb: 0.42 }, volume: 0.82,
  }),
  P('piano-toy', 'Toy Piano', 'Piano', {
    layers: [
      { wave: 'sine', detune: 0, octave: 1, gain: 1 },
      { wave: 'triangle', detune: 11, octave: 2, gain: 0.3 },
      { wave: 'square', detune: -7, octave: 1, gain: 0.12 },
    ],
    filter: { type: 'bandpass', cutoff: 2400, q: 1.8, envAmount: 2, envDecay: 0.1, keyTrack: 0.6, velTrack: 0.6 },
    body: { freq: 3200, gain: 8, q: 2.6 },
    amp: { attack: 0.001, decay: 0.9, sustain: 0.03, release: 0.4 },
    noise: 0.35, noiseDecay: 0.01, noiseFreq: 4200,
    humanize: 0.22, send: { reverb: 0.2 }, volume: 0.62,
  }),

  // ══ Keys ════════════════════════════════════════════════════════════════════
  P('keys-epiano', 'Electric Piano', 'Keys', {
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'sine', detune: 2, octave: 1, gain: 0.28 },
      { wave: 'triangle', detune: -3, octave: 2, gain: 0.1 },
    ],
    filter: { type: 'lowpass', cutoff: 4200, q: 1, envAmount: 1.8, envDecay: 0.25, keyTrack: 0.5, velTrack: 0.85 },
    body: { freq: 900, gain: 4, q: 1 },
    amp: { attack: 0.004, decay: 1.4, sustain: 0.2, release: 0.5 },
    humanize: 0.08, width: 0.2, send: { reverb: 0.2, chorus: 0.25 },
  }),
  P('keys-rhodes', 'DX Rhodes', 'Keys', {
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'sine', detune: 6, octave: 19 / 12, gain: 0.22 },
      { wave: 'sine', detune: -6, octave: 2, gain: 0.12 },
    ],
    filter: { type: 'lowpass', cutoff: 5500, q: 0.8, envAmount: 1.4, envDecay: 0.3, keyTrack: 0.6, velTrack: 0.9 },
    amp: { attack: 0.003, decay: 1.8, sustain: 0.15, release: 0.7 },
    vibrato: { rate: 4, depth: 4 },
    humanize: 0.07, width: 0.3, send: { reverb: 0.22, chorus: 0.35 },
  }),
  P('keys-wurli', 'Wurlitzer', 'Keys', {
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'square', detune: 3, octave: 0, gain: 0.14 },
      { wave: 'sine', detune: -2, octave: 1, gain: 0.3 },
    ],
    filter: { type: 'lowpass', cutoff: 3000, q: 1.4, envAmount: 2.2, envDecay: 0.2, keyTrack: 0.55, velTrack: 0.95 },
    body: { freq: 1500, gain: 6, q: 1.5 },
    amp: { attack: 0.003, decay: 1.5, sustain: 0.18, release: 0.45 },
    drive: 0.22, humanize: 0.1, width: 0.2, send: { reverb: 0.18, chorus: 0.2 }, volume: 0.75,
  }),
  P('keys-clav', 'Clavinet', 'Keys', {
    layers: [{ wave: 'square', detune: 0, octave: 0, gain: 1 }, { wave: 'sawtooth', detune: 5, octave: 0, gain: 0.4 }],
    filter: { type: 'bandpass', cutoff: 1900, q: 2.5, envAmount: 3, envDecay: 0.1, keyTrack: 0.6, velTrack: 1 },
    amp: { attack: 0.002, decay: 0.35, sustain: 0.1, release: 0.15 },
    noise: 0.2, noiseDecay: 0.015, noiseFreq: 3500,
    drive: 0.2, humanize: 0.1, send: { reverb: 0.1 }, volume: 0.7,
  }),
  P('keys-musicbox', 'Music Box', 'Keys', {
    layers: [
      { wave: 'sine', detune: 0, octave: 1, gain: 1 },
      { wave: 'sine', detune: 8, octave: 2, gain: 0.3 },
      { wave: 'triangle', detune: -4, octave: 26 / 12, gain: 0.15 },
    ],
    filter: { type: 'highpass', cutoff: 500, q: 0.8, envAmount: 0, envDecay: 0.1, keyTrack: 0.3, velTrack: 0.4 },
    amp: { attack: 0.001, decay: 1.1, sustain: 0, release: 0.9 },
    humanize: 0.12, send: { reverb: 0.4 }, volume: 0.6,
  }),
  P('keys-celesta', 'Celesta', 'Keys', {
    layers: [{ wave: 'sine', detune: 0, octave: 1, gain: 1 }, { wave: 'sine', detune: 5, octave: 2, gain: 0.25 }],
    filter: { type: 'lowpass', cutoff: 8000, q: 0.7, envAmount: 0.6, envDecay: 0.2, keyTrack: 0.5, velTrack: 0.5 },
    amp: { attack: 0.002, decay: 0.9, sustain: 0.05, release: 0.7 },
    humanize: 0.08, send: { reverb: 0.38 }, volume: 0.6,
  }),
  P('keys-harpsichord', 'Harpsichord', 'Keys', {
    layers: [{ wave: 'sawtooth', detune: 0, octave: 0, gain: 1 }, { wave: 'sawtooth', detune: 7, octave: 1, gain: 0.4 }],
    filter: { type: 'bandpass', cutoff: 2400, q: 1.5, envAmount: 2, envDecay: 0.08, keyTrack: 0.7, velTrack: 0.2 },
    amp: { attack: 0.001, decay: 0.7, sustain: 0.02, release: 0.25 },
    noise: 0.25, noiseDecay: 0.012, noiseFreq: 4500,
    humanize: 0.1, width: 0.2, send: { reverb: 0.26 }, volume: 0.6,
  }),
  P('keys-accordion', 'Accordion', 'Keys', {
    layers: [
      { wave: 'sawtooth', detune: -9, octave: 0, gain: 0.8 },
      { wave: 'square', detune: 9, octave: 0, gain: 0.5 },
      { wave: 'sawtooth', detune: 2, octave: 1, gain: 0.3 },
    ],
    filter: { type: 'bandpass', cutoff: 1400, q: 1.4, envAmount: 0.5, envDecay: 0.15, keyTrack: 0.5, velTrack: 0.5 },
    body: { freq: 2000, gain: 6, q: 1.6 },
    amp: { attack: 0.05, decay: 0.15, sustain: 0.9, release: 0.2 },
    vibrato: { rate: 5.5, depth: 8 },
    humanize: 0.12, width: 0.35, send: { reverb: 0.2 }, volume: 0.55,
  }),
  P('keys-melodica', 'Melodica', 'Keys', {
    layers: [{ wave: 'sawtooth', detune: 0, octave: 0, gain: 1 }, { wave: 'square', detune: 6, octave: 0, gain: 0.3 }],
    filter: { type: 'lowpass', cutoff: 2200, q: 1.6, envAmount: 1, envDecay: 0.12, keyTrack: 0.5, velTrack: 0.6 },
    body: { freq: 1700, gain: 5, q: 1.8 },
    amp: { attack: 0.03, decay: 0.2, sustain: 0.85, release: 0.15 },
    noise: 0.18, noiseDecay: 0.2, noiseFreq: 3500,
    humanize: 0.14, send: { reverb: 0.22 }, volume: 0.6,
  }),

  // ══ Organ ═══════════════════════════════════════════════════════════════════
  P('keys-organ', 'Drawbar Organ', 'Organ', {
    layers: [
      { wave: 'sine', detune: 0, octave: -1, gain: 0.5 },
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'sine', detune: 0, octave: 7 / 12, gain: 0.4 },
      { wave: 'sine', detune: 0, octave: 1, gain: 0.5 },
      { wave: 'sine', detune: 0, octave: 2, gain: 0.22 },
    ],
    filter: { type: 'lowpass', cutoff: 7000, q: 0.6, envAmount: 0, envDecay: 0.1, keyTrack: 0, velTrack: 0.15 },
    amp: { attack: 0.01, decay: 0.05, sustain: 1, release: 0.08 },
    vibrato: { rate: 6.5, depth: 5 },
    width: 0.3, send: { reverb: 0.2, chorus: 0.3 }, volume: 0.55,
  }),
  P('keys-rock-organ', 'Rock Organ', 'Organ', {
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'square', detune: 0, octave: 1, gain: 0.35 },
      { wave: 'sine', detune: 3, octave: 7 / 12, gain: 0.45 },
    ],
    filter: { type: 'lowpass', cutoff: 4500, q: 1.2, envAmount: 0.4, envDecay: 0.2, keyTrack: 0.2, velTrack: 0.3 },
    amp: { attack: 0.012, decay: 0.08, sustain: 1, release: 0.1 },
    drive: 0.45, vibrato: { rate: 6.8, depth: 8 },
    width: 0.35, send: { reverb: 0.2, chorus: 0.25 }, volume: 0.55,
  }),
  P('organ-church', 'Church Pipes', 'Organ', {
    layers: [
      { wave: 'sine', detune: 0, octave: -1, gain: 0.7 },
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'triangle', detune: 2, octave: 1, gain: 0.45 },
      { wave: 'sine', detune: -2, octave: 19 / 12, gain: 0.25 },
      { wave: 'triangle', detune: 0, octave: 2, gain: 0.18 },
    ],
    filter: { type: 'lowpass', cutoff: 3800, q: 0.7, envAmount: 0.3, envDecay: 0.4, keyTrack: 0.3, velTrack: 0.2 },
    amp: { attack: 0.09, decay: 0.1, sustain: 1, release: 0.5 },
    noise: 0.1, noiseDecay: 0.12, noiseFreq: 3000,
    width: 0.45, send: { reverb: 0.65 }, volume: 0.5,
  }),
  P('organ-reed', 'Reed Organ', 'Organ', {
    layers: [
      { wave: 'sawtooth', detune: -5, octave: 0, gain: 0.85 },
      { wave: 'square', detune: 5, octave: 0, gain: 0.45 },
      { wave: 'sawtooth', detune: 0, octave: 1, gain: 0.22 },
    ],
    filter: { type: 'lowpass', cutoff: 2000, q: 1.4, envAmount: 0.4, envDecay: 0.2, keyTrack: 0.35, velTrack: 0.35 },
    body: { freq: 1200, gain: 5, q: 1.4 },
    amp: { attack: 0.06, decay: 0.12, sustain: 0.95, release: 0.22 },
    vibrato: { rate: 4.8, depth: 6 },
    width: 0.28, send: { reverb: 0.26 }, volume: 0.55,
  }),
  P('organ-full', 'Full Stops', 'Organ', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: -1, gain: 0.6 },
      { wave: 'square', detune: 4, octave: 0, gain: 0.9 },
      { wave: 'sawtooth', detune: -4, octave: 1, gain: 0.55 },
      { wave: 'square', detune: 0, octave: 2, gain: 0.25 },
    ],
    filter: { type: 'lowpass', cutoff: 5200, q: 0.9, envAmount: 0.3, envDecay: 0.3, keyTrack: 0.25, velTrack: 0.25 },
    amp: { attack: 0.03, decay: 0.08, sustain: 1, release: 0.3 },
    drive: 0.2, width: 0.5, send: { reverb: 0.55 }, volume: 0.42,
  }),
  P('organ-perc', 'Percussive Organ', 'Organ', {
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'sine', detune: 0, octave: 19 / 12, gain: 0.5 },
      { wave: 'triangle', detune: 0, octave: 2, gain: 0.3 },
    ],
    filter: { type: 'lowpass', cutoff: 6000, q: 1, envAmount: 1.6, envDecay: 0.12, keyTrack: 0.3, velTrack: 0.5 },
    amp: { attack: 0.002, decay: 0.28, sustain: 0.55, release: 0.1 },
    drive: 0.3, vibrato: { rate: 6.8, depth: 6 },
    width: 0.3, send: { reverb: 0.18, chorus: 0.3 }, volume: 0.55,
  }),

  // ══ Synth Lead ══════════════════════════════════════════════════════════════
  P('lead-saw', 'Classic Saw', 'Synth Lead', {
    layers: [{ wave: 'sawtooth', detune: 0, octave: 0, gain: 1 }, { wave: 'sawtooth', detune: 9, octave: 0, gain: 0.6 }],
    filter: { type: 'lowpass', cutoff: 3200, q: 3, envAmount: 1.6, envDecay: 0.4, keyTrack: 0.4, velTrack: 0.6 },
    amp: { attack: 0.01, decay: 0.3, sustain: 0.75, release: 0.25 },
    width: 0.25, send: { reverb: 0.18, delay: 0.18 },
  }),
  P('lead-square', 'Square Lead', 'Synth Lead', {
    layers: [{ wave: 'square', detune: 0, octave: 0, gain: 1 }, { wave: 'square', detune: -7, octave: 0, gain: 0.5 }],
    filter: { type: 'lowpass', cutoff: 2600, q: 4, envAmount: 1.2, envDecay: 0.35, keyTrack: 0.3, velTrack: 0.6 },
    amp: { attack: 0.008, decay: 0.25, sustain: 0.7, release: 0.2 },
    width: 0.2, send: { reverb: 0.16, delay: 0.2 },
  }),
  P('lead-supersaw', 'Supersaw', 'Synth Lead', {
    layers: [
      { wave: 'sawtooth', detune: -16, octave: 0, gain: 0.7 },
      { wave: 'sawtooth', detune: -6, octave: 0, gain: 0.85 },
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 1 },
      { wave: 'sawtooth', detune: 6, octave: 0, gain: 0.85 },
      { wave: 'sawtooth', detune: 16, octave: 0, gain: 0.7 },
    ],
    filter: { type: 'lowpass', cutoff: 5200, q: 1.4, envAmount: 1.1, envDecay: 0.5, keyTrack: 0.3, velTrack: 0.5 },
    amp: { attack: 0.02, decay: 0.4, sustain: 0.8, release: 0.4 },
    width: 0.7, send: { reverb: 0.24, delay: 0.22 }, volume: 0.6,
  }),
  P('lead-hoover', 'Hoover', 'Synth Lead', {
    layers: [
      { wave: 'sawtooth', detune: -22, octave: 0, gain: 0.9 },
      { wave: 'sawtooth', detune: 22, octave: 0, gain: 0.9 },
      { wave: 'square', detune: 0, octave: -1, gain: 0.5 },
      { wave: 'sawtooth', detune: 8, octave: 7 / 12, gain: 0.4 },
    ],
    filter: { type: 'lowpass', cutoff: 2400, q: 5, envAmount: 3, envDecay: 0.5, keyTrack: 0.3, velTrack: 0.5 },
    amp: { attack: 0.02, decay: 0.4, sustain: 0.8, release: 0.35 },
    drive: 0.4, glide: 0.06, width: 0.6, send: { reverb: 0.2, delay: 0.2 }, volume: 0.45,
  }),
  P('lead-acid', 'Acid 303', 'Synth Lead', {
    layers: [{ wave: 'sawtooth', detune: 0, octave: 0, gain: 1 }],
    filter: { type: 'lowpass', cutoff: 700, q: 14, envAmount: 5, envDecay: 0.22, keyTrack: 0.5, velTrack: 0.9 },
    amp: { attack: 0.003, decay: 0.18, sustain: 0.4, release: 0.1 },
    drive: 0.35, glide: 0.05, send: { reverb: 0.14, delay: 0.28 },
  }),
  P('lead-pwm', 'PWM Lead', 'Synth Lead', {
    layers: [{ wave: 'square', detune: 0, octave: 0, gain: 1 }, { wave: 'sawtooth', detune: 12, octave: 0, gain: 0.35 }],
    filter: { type: 'lowpass', cutoff: 3600, q: 2.5, envAmount: 1, envDecay: 0.45, keyTrack: 0.35, velTrack: 0.6 },
    amp: { attack: 0.03, decay: 0.3, sustain: 0.8, release: 0.3 },
    vibrato: { rate: 5, depth: 8 },
    width: 0.35, send: { reverb: 0.2, chorus: 0.3 },
  }),
  P('lead-sync', 'Sync Lead', 'Synth Lead', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 1 },
      { wave: 'square', detune: 4, octave: 19 / 12, gain: 0.5 },
      { wave: 'sawtooth', detune: -4, octave: 1, gain: 0.3 },
    ],
    filter: { type: 'bandpass', cutoff: 1800, q: 6, envAmount: 4, envDecay: 0.3, keyTrack: 0.4, velTrack: 0.8 },
    amp: { attack: 0.004, decay: 0.3, sustain: 0.7, release: 0.2 },
    drive: 0.35, width: 0.3, send: { reverb: 0.16, delay: 0.2 }, volume: 0.55,
  }),
  P('lead-chip', 'Chiptune', 'Synth Lead', {
    layers: [{ wave: 'square', detune: 0, octave: 0, gain: 1 }],
    filter: { type: 'lowpass', cutoff: 12000, q: 0.5, envAmount: 0, envDecay: 0.1, keyTrack: 0, velTrack: 0.2 },
    amp: { attack: 0.001, decay: 0.08, sustain: 0.85, release: 0.03 },
    vibrato: { rate: 7, depth: 14 },
    send: { reverb: 0.08, delay: 0.16 }, volume: 0.55,
  }),
  P('lead-fifths', 'Fifths Lead', 'Synth Lead', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 1 },
      { wave: 'sawtooth', detune: 2, octave: 7 / 12, gain: 0.7 },
    ],
    filter: { type: 'lowpass', cutoff: 3400, q: 2, envAmount: 1.3, envDecay: 0.4, keyTrack: 0.3, velTrack: 0.6 },
    amp: { attack: 0.015, decay: 0.3, sustain: 0.75, release: 0.3 },
    width: 0.4, send: { reverb: 0.2, delay: 0.18 }, volume: 0.65,
  }),
  P('lead-bell', 'Bell Lead', 'Synth Lead', {
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'sine', detune: 4, octave: 19 / 12, gain: 0.35 },
      { wave: 'triangle', detune: 0, octave: 1, gain: 0.25 },
    ],
    filter: { type: 'lowpass', cutoff: 9000, q: 1, envAmount: 0.5, envDecay: 0.3, keyTrack: 0.5, velTrack: 0.7 },
    amp: { attack: 0.002, decay: 1.2, sustain: 0.15, release: 0.9 },
    width: 0.3, send: { reverb: 0.38, delay: 0.24 },
  }),
  P('lead-formant', 'Formant Lead', 'Synth Lead', {
    layers: [{ wave: 'sawtooth', detune: 0, octave: 0, gain: 1 }, { wave: 'square', detune: -8, octave: 0, gain: 0.4 }],
    filter: { type: 'bandpass', cutoff: 1000, q: 7, envAmount: 3.2, envDecay: 0.35, keyTrack: 0.3, velTrack: 0.7 },
    body: { freq: 2600, gain: 9, q: 4 },
    amp: { attack: 0.03, decay: 0.3, sustain: 0.75, release: 0.3 },
    vibrato: { rate: 5.2, depth: 12 },
    width: 0.25, send: { reverb: 0.24, delay: 0.2 }, volume: 0.6,
  }),
  P('lead-hollow', 'Hollow Lead', 'Synth Lead', {
    layers: [{ wave: 'triangle', detune: 0, octave: 0, gain: 1 }, { wave: 'square', detune: 6, octave: -1, gain: 0.4 }],
    filter: { type: 'lowpass', cutoff: 2400, q: 5, envAmount: 1.4, envDecay: 0.5, keyTrack: 0.4, velTrack: 0.6 },
    amp: { attack: 0.04, decay: 0.35, sustain: 0.7, release: 0.4 },
    vibrato: { rate: 4.5, depth: 12 },
    width: 0.3, send: { reverb: 0.28, delay: 0.2 },
  }),
  P('lead-retro-arp', 'Retro Arp', 'Synth Lead', {
    layers: [{ wave: 'square', detune: 0, octave: 0, gain: 1 }, { wave: 'sawtooth', detune: 7, octave: 1, gain: 0.3 }],
    filter: { type: 'lowpass', cutoff: 2200, q: 7, envAmount: 4, envDecay: 0.12, keyTrack: 0.4, velTrack: 0.8 },
    amp: { attack: 0.002, decay: 0.16, sustain: 0.25, release: 0.1 },
    send: { reverb: 0.18, delay: 0.35 }, volume: 0.6,
  }),
  P('lead-portamento', 'Glide Lead', 'Synth Lead', {
    layers: [{ wave: 'sawtooth', detune: 0, octave: 0, gain: 1 }, { wave: 'square', detune: -9, octave: 0, gain: 0.45 }],
    filter: { type: 'lowpass', cutoff: 3000, q: 6, envAmount: 1.8, envDecay: 0.35, keyTrack: 0.4, velTrack: 0.7 },
    amp: { attack: 0.02, decay: 0.25, sustain: 0.8, release: 0.35 },
    glide: 0.12, drive: 0.2, width: 0.25, send: { reverb: 0.22, delay: 0.22 },
  }),

  // ══ Synth Pad ═══════════════════════════════════════════════════════════════
  P('pad-warm', 'Warm Pad', 'Synth Pad', {
    layers: [
      { wave: 'sawtooth', detune: -8, octave: 0, gain: 0.8 },
      { wave: 'sawtooth', detune: 8, octave: 0, gain: 0.8 },
      { wave: 'triangle', detune: 0, octave: -1, gain: 0.5 },
    ],
    filter: { type: 'lowpass', cutoff: 1800, q: 1, envAmount: 1.5, envDecay: 1.6, keyTrack: 0.3, velTrack: 0.4 },
    amp: { attack: 0.7, decay: 1.2, sustain: 0.8, release: 1.6 },
    width: 0.6, send: { reverb: 0.45, chorus: 0.3 }, volume: 0.55,
  }),
  P('pad-strings', 'Analog Strings', 'Synth Pad', {
    layers: [
      { wave: 'sawtooth', detune: -12, octave: 0, gain: 0.7 },
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 0.9 },
      { wave: 'sawtooth', detune: 12, octave: 0, gain: 0.7 },
    ],
    filter: { type: 'lowpass', cutoff: 2600, q: 1.2, envAmount: 0.8, envDecay: 1.2, keyTrack: 0.35, velTrack: 0.4 },
    amp: { attack: 0.35, decay: 0.8, sustain: 0.85, release: 1.1 },
    vibrato: { rate: 4.8, depth: 6 },
    width: 0.65, send: { reverb: 0.42, chorus: 0.35 }, volume: 0.55,
  }),
  P('pad-glass', 'Glass Pad', 'Synth Pad', {
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'sine', detune: 5, octave: 1, gain: 0.4 },
      { wave: 'triangle', detune: -5, octave: 2, gain: 0.18 },
    ],
    filter: { type: 'lowpass', cutoff: 5000, q: 1.5, envAmount: 1, envDecay: 2, keyTrack: 0.5, velTrack: 0.4 },
    amp: { attack: 0.5, decay: 1.5, sustain: 0.6, release: 2 },
    width: 0.55, send: { reverb: 0.55, delay: 0.2 }, volume: 0.6,
  }),
  P('pad-choir', 'Choir Pad', 'Synth Pad', {
    layers: [
      { wave: 'triangle', detune: -7, octave: 0, gain: 0.8 },
      { wave: 'triangle', detune: 7, octave: 0, gain: 0.8 },
      { wave: 'sine', detune: 0, octave: 1, gain: 0.3 },
    ],
    filter: { type: 'bandpass', cutoff: 1100, q: 1.6, envAmount: 0.6, envDecay: 1.4, keyTrack: 0.6, velTrack: 0.35 },
    body: { freq: 2400, gain: 6, q: 1.2 },
    amp: { attack: 0.6, decay: 1, sustain: 0.85, release: 1.4 },
    vibrato: { rate: 5.2, depth: 9 },
    width: 0.6, send: { reverb: 0.6 }, volume: 0.6,
  }),
  P('pad-dark', 'Dark Pad', 'Synth Pad', {
    layers: [
      { wave: 'sawtooth', detune: -14, octave: -1, gain: 0.9 },
      { wave: 'square', detune: 6, octave: -1, gain: 0.5 },
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 0.4 },
    ],
    filter: { type: 'lowpass', cutoff: 800, q: 2.5, envAmount: 1.4, envDecay: 2.5, keyTrack: 0.25, velTrack: 0.35 },
    amp: { attack: 1.1, decay: 1.5, sustain: 0.75, release: 2.2 },
    width: 0.5, send: { reverb: 0.5 }, volume: 0.55,
  }),
  P('pad-sweep', 'Sweep Pad', 'Synth Pad', {
    layers: [
      { wave: 'sawtooth', detune: -10, octave: 0, gain: 0.8 },
      { wave: 'sawtooth', detune: 10, octave: 0, gain: 0.8 },
    ],
    filter: { type: 'lowpass', cutoff: 400, q: 7, envAmount: 12, envDecay: 2.5, keyTrack: 0.2, velTrack: 0.5 },
    amp: { attack: 0.4, decay: 2, sustain: 0.7, release: 1.8 },
    width: 0.55, send: { reverb: 0.5, delay: 0.2 }, volume: 0.55,
  }),
  P('pad-vapor', 'Vapor Pad', 'Synth Pad', {
    layers: [
      { wave: 'triangle', detune: -18, octave: 0, gain: 0.7 },
      { wave: 'sine', detune: 18, octave: 0, gain: 0.7 },
      { wave: 'sawtooth', detune: 0, octave: -1, gain: 0.35 },
    ],
    filter: { type: 'lowpass', cutoff: 1500, q: 2, envAmount: 1, envDecay: 3, keyTrack: 0.3, velTrack: 0.3 },
    amp: { attack: 1.4, decay: 2, sustain: 0.7, release: 2.6 },
    vibrato: { rate: 2.2, depth: 14 },
    width: 0.75, send: { reverb: 0.7, chorus: 0.4, delay: 0.25 }, volume: 0.55,
  }),
  P('pad-nebula', 'Nebula', 'Synth Pad', {
    layers: [
      { wave: 'sine', detune: -24, octave: 0, gain: 0.6 },
      { wave: 'triangle', detune: 24, octave: 1, gain: 0.45 },
      { wave: 'sawtooth', detune: 0, octave: -1, gain: 0.35 },
      { wave: 'sine', detune: 12, octave: 2, gain: 0.15 },
    ],
    filter: { type: 'lowpass', cutoff: 2600, q: 3, envAmount: 2, envDecay: 4, keyTrack: 0.35, velTrack: 0.3 },
    amp: { attack: 2, decay: 2.5, sustain: 0.7, release: 3.4 },
    vibrato: { rate: 0.7, depth: 18 },
    width: 0.85, send: { reverb: 0.8, delay: 0.3, chorus: 0.3 }, volume: 0.5,
  }),
  P('pad-halo', 'Halo', 'Synth Pad', {
    layers: [
      { wave: 'sine', detune: -6, octave: 1, gain: 0.8 },
      { wave: 'triangle', detune: 6, octave: 1, gain: 0.6 },
      { wave: 'sine', detune: 0, octave: 2, gain: 0.22 },
    ],
    filter: { type: 'highpass', cutoff: 700, q: 1, envAmount: 0.5, envDecay: 2.5, keyTrack: 0.5, velTrack: 0.3 },
    amp: { attack: 1.6, decay: 2, sustain: 0.7, release: 3 },
    width: 0.8, send: { reverb: 0.85, delay: 0.25 }, volume: 0.5,
  }),
  P('pad-motion', 'Motion Pad', 'Synth Pad', {
    layers: [
      { wave: 'sawtooth', detune: -16, octave: 0, gain: 0.75 },
      { wave: 'square', detune: 16, octave: 0, gain: 0.45 },
      { wave: 'triangle', detune: 0, octave: 1, gain: 0.3 },
    ],
    filter: { type: 'bandpass', cutoff: 900, q: 5, envAmount: 8, envDecay: 3.5, keyTrack: 0.3, velTrack: 0.4 },
    amp: { attack: 0.9, decay: 2, sustain: 0.75, release: 2 },
    vibrato: { rate: 3.4, depth: 10 },
    width: 0.7, send: { reverb: 0.5, delay: 0.35, chorus: 0.35 }, volume: 0.5,
  }),
  P('pad-sub', 'Sub Pad', 'Synth Pad', {
    layers: [
      { wave: 'sine', detune: 0, octave: -1, gain: 1 },
      { wave: 'triangle', detune: 5, octave: 0, gain: 0.4 },
    ],
    filter: { type: 'lowpass', cutoff: 600, q: 1.2, envAmount: 0.8, envDecay: 2, keyTrack: 0.25, velTrack: 0.3 },
    amp: { attack: 0.9, decay: 1.5, sustain: 0.85, release: 2 },
    width: 0.25, send: { reverb: 0.3 }, volume: 0.7,
  }),
  P('pad-octave', 'Octave Pad', 'Synth Pad', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: -1, gain: 0.8 },
      { wave: 'sawtooth', detune: 6, octave: 0, gain: 0.8 },
      { wave: 'triangle', detune: -6, octave: 1, gain: 0.4 },
    ],
    filter: { type: 'lowpass', cutoff: 2200, q: 1.2, envAmount: 1.2, envDecay: 1.5, keyTrack: 0.4, velTrack: 0.4 },
    amp: { attack: 0.55, decay: 1, sustain: 0.8, release: 1.5 },
    width: 0.6, send: { reverb: 0.45, chorus: 0.25 }, volume: 0.55,
  }),
  P('pad-air', 'Air Pad', 'Synth Pad', {
    layers: [{ wave: 'sine', detune: -4, octave: 1, gain: 0.7 }, { wave: 'triangle', detune: 4, octave: 1, gain: 0.5 }],
    filter: { type: 'highpass', cutoff: 900, q: 0.8, envAmount: 0.4, envDecay: 2, keyTrack: 0.5, velTrack: 0.3 },
    amp: { attack: 1.2, decay: 1.8, sustain: 0.65, release: 2.4 },
    noise: 0.12, noiseDecay: 1.5, noiseFreq: 6000,
    width: 0.8, send: { reverb: 0.7, delay: 0.2 }, volume: 0.5,
  }),
  P('pad-cinematic', 'Cinematic', 'Synth Pad', {
    layers: [
      { wave: 'sawtooth', detune: -20, octave: -1, gain: 0.8 },
      { wave: 'sawtooth', detune: 20, octave: 0, gain: 0.7 },
      { wave: 'square', detune: 0, octave: -2, gain: 0.45 },
      { wave: 'sine', detune: 8, octave: 1, gain: 0.25 },
    ],
    filter: { type: 'lowpass', cutoff: 1200, q: 3, envAmount: 4, envDecay: 3, keyTrack: 0.25, velTrack: 0.4 },
    amp: { attack: 1.5, decay: 2.5, sustain: 0.8, release: 3 },
    width: 0.75, send: { reverb: 0.75, delay: 0.2 }, volume: 0.5,
  }),

  // ══ Synth Bass ══════════════════════════════════════════════════════════════
  P('bass-sub', 'Sub Bass', 'Synth Bass', {
    layers: [{ wave: 'sine', detune: 0, octave: 0, gain: 1 }],
    filter: { type: 'lowpass', cutoff: 400, q: 0.7, envAmount: 0.5, envDecay: 0.2, keyTrack: 0.2, velTrack: 0.3 },
    amp: { attack: 0.008, decay: 0.2, sustain: 0.9, release: 0.15 },
    octave: -1, volume: 0.9, send: { reverb: 0.02 },
  }),
  P('bass-reese', 'Reese Bass', 'Synth Bass', {
    layers: [
      { wave: 'sawtooth', detune: -14, octave: 0, gain: 1 },
      { wave: 'sawtooth', detune: 14, octave: 0, gain: 1 },
      { wave: 'sine', detune: 0, octave: -1, gain: 0.7 },
    ],
    filter: { type: 'lowpass', cutoff: 900, q: 4, envAmount: 1.2, envDecay: 0.3, keyTrack: 0.3, velTrack: 0.6 },
    amp: { attack: 0.01, decay: 0.25, sustain: 0.85, release: 0.2 },
    drive: 0.3, octave: -1, width: 0.3, volume: 0.7, send: { reverb: 0.05 },
  }),
  P('bass-303', 'Acid Bass', 'Synth Bass', {
    layers: [{ wave: 'sawtooth', detune: 0, octave: 0, gain: 1 }],
    filter: { type: 'lowpass', cutoff: 350, q: 15, envAmount: 7, envDecay: 0.2, keyTrack: 0.4, velTrack: 0.95 },
    amp: { attack: 0.003, decay: 0.2, sustain: 0.3, release: 0.08 },
    drive: 0.45, glide: 0.06, octave: -1, volume: 0.75, send: { reverb: 0.06, delay: 0.15 },
  }),
  P('bass-fm', 'FM Bass', 'Synth Bass', {
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'square', detune: 3, octave: 1, gain: 0.3 },
      { wave: 'sine', detune: 0, octave: -1, gain: 0.6 },
    ],
    filter: { type: 'lowpass', cutoff: 1400, q: 2, envAmount: 2.5, envDecay: 0.15, keyTrack: 0.3, velTrack: 0.8 },
    amp: { attack: 0.004, decay: 0.3, sustain: 0.6, release: 0.15 },
    octave: -1, volume: 0.8, send: { reverb: 0.04 },
  }),
  P('bass-neuro', 'Neuro Bass', 'Synth Bass', {
    layers: [
      { wave: 'sawtooth', detune: -18, octave: 0, gain: 1 },
      { wave: 'square', detune: 18, octave: 0, gain: 0.7 },
      { wave: 'sawtooth', detune: 5, octave: 1, gain: 0.3 },
      { wave: 'sine', detune: 0, octave: -1, gain: 0.8 },
    ],
    filter: { type: 'bandpass', cutoff: 700, q: 11, envAmount: 8, envDecay: 0.3, keyTrack: 0.25, velTrack: 0.7 },
    amp: { attack: 0.006, decay: 0.3, sustain: 0.8, release: 0.15 },
    drive: 0.8, octave: -1, width: 0.35, volume: 0.5, send: { reverb: 0.05 },
  }),
  P('bass-growl', 'Growl Bass', 'Synth Bass', {
    layers: [
      { wave: 'sawtooth', detune: -8, octave: 0, gain: 1 },
      { wave: 'square', detune: 8, octave: 0, gain: 0.7 },
    ],
    filter: { type: 'lowpass', cutoff: 600, q: 10, envAmount: 4, envDecay: 0.4, keyTrack: 0.3, velTrack: 0.7 },
    amp: { attack: 0.01, decay: 0.35, sustain: 0.75, release: 0.2 },
    drive: 0.6, vibrato: { rate: 5.5, depth: 20 }, octave: -1, volume: 0.65, send: { reverb: 0.05 },
  }),
  P('bass-hard', 'Hard Bass', 'Synth Bass', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 1 },
      { wave: 'square', detune: 0, octave: -1, gain: 0.9 },
    ],
    filter: { type: 'lowpass', cutoff: 800, q: 3, envAmount: 3, envDecay: 0.1, keyTrack: 0.3, velTrack: 0.7 },
    amp: { attack: 0.002, decay: 0.2, sustain: 0.55, release: 0.1 },
    drive: 0.9, octave: -1, volume: 0.5, send: { reverb: 0.04 },
  }),
  P('bass-pluck', 'Pluck Bass', 'Synth Bass', {
    layers: [{ wave: 'sawtooth', detune: 0, octave: 0, gain: 1 }, { wave: 'sine', detune: 0, octave: -1, gain: 0.8 }],
    filter: { type: 'lowpass', cutoff: 500, q: 6, envAmount: 6, envDecay: 0.12, keyTrack: 0.3, velTrack: 0.9 },
    amp: { attack: 0.002, decay: 0.25, sustain: 0.15, release: 0.2 },
    octave: -1, volume: 0.8, send: { reverb: 0.08 },
  }),
  P('bass-square', 'Square Bass', 'Synth Bass', {
    layers: [{ wave: 'square', detune: 0, octave: 0, gain: 1 }, { wave: 'sine', detune: 0, octave: -1, gain: 0.6 }],
    filter: { type: 'lowpass', cutoff: 800, q: 2, envAmount: 1.5, envDecay: 0.25, keyTrack: 0.3, velTrack: 0.6 },
    amp: { attack: 0.005, decay: 0.2, sustain: 0.8, release: 0.12 },
    octave: -1, volume: 0.8, send: { reverb: 0.05 },
  }),
  P('bass-saw', 'Saw Bass', 'Synth Bass', {
    layers: [{ wave: 'sawtooth', detune: -5, octave: 0, gain: 1 }, { wave: 'sawtooth', detune: 5, octave: 0, gain: 0.8 }],
    filter: { type: 'lowpass', cutoff: 1100, q: 3, envAmount: 2, envDecay: 0.3, keyTrack: 0.3, velTrack: 0.6 },
    amp: { attack: 0.006, decay: 0.25, sustain: 0.8, release: 0.18 },
    octave: -1, volume: 0.75, send: { reverb: 0.05 },
  }),
  P('bass-tape', 'Tape Bass', 'Synth Bass', {
    layers: [
      { wave: 'triangle', detune: 0, octave: 0, gain: 1 },
      { wave: 'sine', detune: -6, octave: -1, gain: 0.8 },
    ],
    filter: { type: 'lowpass', cutoff: 480, q: 1.6, envAmount: 1.4, envDecay: 0.3, keyTrack: 0.25, velTrack: 0.5 },
    body: { freq: 260, gain: 4, q: 1 },
    amp: { attack: 0.02, decay: 0.4, sustain: 0.7, release: 0.3 },
    drive: 0.25, humanize: 0.2, vibrato: { rate: 1.6, depth: 6 },
    octave: -1, volume: 0.8, send: { reverb: 0.12 },
  }),
  P('bass-wobble', 'Wobble Bass', 'Synth Bass', {
    layers: [
      { wave: 'sawtooth', detune: -10, octave: 0, gain: 1 },
      { wave: 'square', detune: 10, octave: 0, gain: 0.6 },
      { wave: 'sine', detune: 0, octave: -1, gain: 0.8 },
    ],
    filter: { type: 'lowpass', cutoff: 300, q: 13, envAmount: 9, envDecay: 0.55, keyTrack: 0.2, velTrack: 0.6 },
    amp: { attack: 0.01, decay: 0.4, sustain: 0.8, release: 0.25 },
    drive: 0.5, octave: -1, volume: 0.65, send: { reverb: 0.05 },
  }),
  P('bass-house', 'Deep House Bass', 'Synth Bass', {
    layers: [{ wave: 'triangle', detune: 0, octave: 0, gain: 1 }, { wave: 'sine', detune: 4, octave: -1, gain: 0.7 }],
    filter: { type: 'lowpass', cutoff: 550, q: 3, envAmount: 2, envDecay: 0.25, keyTrack: 0.25, velTrack: 0.6 },
    amp: { attack: 0.012, decay: 0.3, sustain: 0.7, release: 0.25 },
    octave: -1, volume: 0.8, send: { reverb: 0.1 },
  }),

  // ══ Synth Pluck ═════════════════════════════════════════════════════════════
  P('pluck-digital', 'Digital Pluck', 'Synth Pluck', {
    layers: [{ wave: 'sawtooth', detune: 0, octave: 0, gain: 1 }, { wave: 'square', detune: 9, octave: 1, gain: 0.28 }],
    filter: { type: 'lowpass', cutoff: 2600, q: 5, envAmount: 5, envDecay: 0.1, keyTrack: 0.5, velTrack: 0.9 },
    amp: { attack: 0.002, decay: 0.35, sustain: 0.02, release: 0.25 },
    width: 0.35, send: { reverb: 0.35, delay: 0.3 }, volume: 0.7,
  }),
  P('pluck-analog', 'Analog Pluck', 'Synth Pluck', {
    layers: [{ wave: 'sawtooth', detune: -6, octave: 0, gain: 1 }, { wave: 'sawtooth', detune: 6, octave: 0, gain: 0.7 }],
    filter: { type: 'lowpass', cutoff: 1800, q: 6, envAmount: 6, envDecay: 0.13, keyTrack: 0.45, velTrack: 0.9 },
    amp: { attack: 0.003, decay: 0.45, sustain: 0.04, release: 0.3 },
    width: 0.4, send: { reverb: 0.32, delay: 0.25 }, volume: 0.7,
  }),
  P('pluck-bell-syn', 'Bell Pluck', 'Synth Pluck', {
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'sine', detune: 7, octave: 19 / 12, gain: 0.4 },
      { wave: 'triangle', detune: -7, octave: 2, gain: 0.18 },
    ],
    filter: { type: 'lowpass', cutoff: 6000, q: 1.6, envAmount: 2, envDecay: 0.15, keyTrack: 0.55, velTrack: 0.7 },
    amp: { attack: 0.001, decay: 0.9, sustain: 0.02, release: 0.8 },
    width: 0.4, send: { reverb: 0.5, delay: 0.35 }, volume: 0.65,
  }),
  P('pluck-sync', 'Sync Pluck', 'Synth Pluck', {
    layers: [
      { wave: 'square', detune: 0, octave: 0, gain: 1 },
      { wave: 'sawtooth', detune: 5, octave: 19 / 12, gain: 0.45 },
    ],
    filter: { type: 'bandpass', cutoff: 1600, q: 8, envAmount: 6, envDecay: 0.09, keyTrack: 0.5, velTrack: 0.95 },
    amp: { attack: 0.001, decay: 0.3, sustain: 0.02, release: 0.2 },
    drive: 0.3, width: 0.3, send: { reverb: 0.3, delay: 0.3 }, volume: 0.6,
  }),
  P('pluck-house', 'House Pluck', 'Synth Pluck', {
    layers: [
      { wave: 'sawtooth', detune: -10, octave: 0, gain: 0.9 },
      { wave: 'sawtooth', detune: 10, octave: 0, gain: 0.9 },
      { wave: 'square', detune: 0, octave: 1, gain: 0.25 },
    ],
    filter: { type: 'lowpass', cutoff: 2400, q: 7, envAmount: 5, envDecay: 0.11, keyTrack: 0.45, velTrack: 0.9 },
    amp: { attack: 0.002, decay: 0.32, sustain: 0.03, release: 0.22 },
    width: 0.55, send: { reverb: 0.35, delay: 0.35 }, volume: 0.6,
  }),
  P('pluck-ambient', 'Ambient Pluck', 'Synth Pluck', {
    layers: [
      { wave: 'triangle', detune: -4, octave: 0, gain: 1 },
      { wave: 'sine', detune: 4, octave: 1, gain: 0.35 },
    ],
    filter: { type: 'lowpass', cutoff: 2000, q: 2.5, envAmount: 3, envDecay: 0.25, keyTrack: 0.5, velTrack: 0.6 },
    amp: { attack: 0.006, decay: 1.1, sustain: 0.03, release: 1.4 },
    width: 0.6, send: { reverb: 0.75, delay: 0.45 }, volume: 0.65,
  }),
  P('pluck-wood', 'Wood Pluck', 'Synth Pluck', {
    layers: [{ wave: 'triangle', detune: 0, octave: 0, gain: 1 }, { wave: 'square', detune: 11, octave: 0, gain: 0.16 }],
    filter: { type: 'bandpass', cutoff: 1200, q: 3, envAmount: 4, envDecay: 0.08, keyTrack: 0.5, velTrack: 0.8 },
    body: { freq: 700, gain: 7, q: 2 },
    amp: { attack: 0.001, decay: 0.4, sustain: 0.02, release: 0.25 },
    noise: 0.3, noiseDecay: 0.012, noiseFreq: 2400,
    humanize: 0.15, send: { reverb: 0.3, delay: 0.15 }, volume: 0.72,
  }),
  P('pluck-glass-syn', 'Glass Pluck', 'Synth Pluck', {
    layers: [
      { wave: 'sine', detune: 0, octave: 1, gain: 1 },
      { wave: 'sine', detune: 13, octave: 2, gain: 0.25 },
    ],
    filter: { type: 'highpass', cutoff: 900, q: 1.4, envAmount: 1, envDecay: 0.2, keyTrack: 0.5, velTrack: 0.6 },
    amp: { attack: 0.001, decay: 0.8, sustain: 0.01, release: 0.7 },
    width: 0.5, send: { reverb: 0.6, delay: 0.4 }, volume: 0.6,
  }),

  // ══ Electric Guitar ═════════════════════════════════════════════════════════
  P('gtr-clean', 'Clean Strat', 'Electric Guitar', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 0.75 },
      { wave: 'square', detune: 4, octave: 0, gain: 0.35 },
      { wave: 'triangle', detune: -4, octave: 1, gain: 0.2 },
    ],
    filter: { type: 'lowpass', cutoff: 2600, q: 1.8, envAmount: 1.8, envDecay: 0.18, keyTrack: 0.5, velTrack: 0.85 },
    body: { freq: 1450, gain: 6, q: 1.4 },
    amp: { attack: 0.004, decay: 1, sustain: 0.32, release: 0.4 },
    noise: 0.3, noiseDecay: 0.02, noiseFreq: 3200,
    humanize: 0.16, width: 0.2, send: { reverb: 0.3, delay: 0.12 }, volume: 0.7,
  }),
  P('gtr-jazz', 'Jazz Hollow', 'Electric Guitar', {
    layers: [{ wave: 'triangle', detune: 0, octave: 0, gain: 1 }, { wave: 'sine', detune: 5, octave: 1, gain: 0.25 }],
    filter: { type: 'lowpass', cutoff: 1400, q: 1.6, envAmount: 1.5, envDecay: 0.2, keyTrack: 0.5, velTrack: 0.8 },
    body: { freq: 700, gain: 5, q: 1.2 },
    amp: { attack: 0.006, decay: 1.4, sustain: 0.28, release: 0.5 },
    noise: 0.18, noiseDecay: 0.02, noiseFreq: 2200,
    humanize: 0.18, send: { reverb: 0.28 }, volume: 0.72,
  }),
  P('gtr-jangle', 'Jangle 12', 'Electric Guitar', {
    layers: [
      { wave: 'sawtooth', detune: -11, octave: 0, gain: 0.7 },
      { wave: 'sawtooth', detune: 11, octave: 0, gain: 0.7 },
      { wave: 'triangle', detune: -7, octave: 1, gain: 0.4 },
      { wave: 'triangle', detune: 7, octave: 1, gain: 0.4 },
    ],
    filter: { type: 'lowpass', cutoff: 3800, q: 1.5, envAmount: 1.8, envDecay: 0.15, keyTrack: 0.55, velTrack: 0.8 },
    body: { freq: 1900, gain: 7, q: 1.4 },
    amp: { attack: 0.003, decay: 1.3, sustain: 0.25, release: 0.55 },
    noise: 0.35, noiseDecay: 0.018, noiseFreq: 3600,
    humanize: 0.2, width: 0.55, send: { reverb: 0.35, chorus: 0.25 }, volume: 0.55,
  }),
  P('gtr-crunch', 'Crunch Rhythm', 'Electric Guitar', {
    layers: [
      { wave: 'sawtooth', detune: -5, octave: 0, gain: 0.9 },
      { wave: 'square', detune: 5, octave: 0, gain: 0.6 },
    ],
    filter: { type: 'lowpass', cutoff: 3000, q: 2.5, envAmount: 1.4, envDecay: 0.2, keyTrack: 0.45, velTrack: 0.75 },
    body: { freq: 1200, gain: 7, q: 1.6 },
    amp: { attack: 0.004, decay: 0.9, sustain: 0.4, release: 0.35 },
    noise: 0.28, noiseDecay: 0.018, noiseFreq: 3000,
    drive: 0.55, humanize: 0.14, width: 0.25, send: { reverb: 0.2 }, volume: 0.55,
  }),
  P('gtr-overdrive', 'Overdrive Lead', 'Electric Guitar', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 1 },
      { wave: 'sawtooth', detune: 8, octave: 0, gain: 0.55 },
    ],
    filter: { type: 'lowpass', cutoff: 3400, q: 3.5, envAmount: 1.2, envDecay: 0.3, keyTrack: 0.4, velTrack: 0.7 },
    body: { freq: 1800, gain: 8, q: 2 },
    amp: { attack: 0.006, decay: 1.2, sustain: 0.65, release: 0.5 },
    noise: 0.2, noiseDecay: 0.015, noiseFreq: 3400,
    drive: 0.75, vibrato: { rate: 5.5, depth: 10 },
    humanize: 0.14, send: { reverb: 0.3, delay: 0.2 }, volume: 0.5,
  }),
  P('gtr-distortion', 'Heavy Distortion', 'Electric Guitar', {
    layers: [
      { wave: 'sawtooth', detune: -7, octave: 0, gain: 1 },
      { wave: 'square', detune: 7, octave: 0, gain: 0.8 },
      { wave: 'sawtooth', detune: 0, octave: -1, gain: 0.5 },
    ],
    filter: { type: 'lowpass', cutoff: 3800, q: 4, envAmount: 1, envDecay: 0.25, keyTrack: 0.35, velTrack: 0.5 },
    body: { freq: 900, gain: 9, q: 1.8 },
    amp: { attack: 0.004, decay: 1.5, sustain: 0.7, release: 0.45 },
    noise: 0.22, noiseDecay: 0.016, noiseFreq: 3600,
    drive: 0.95, humanize: 0.1, width: 0.3, send: { reverb: 0.22 }, volume: 0.4,
  }),
  P('gtr-shoegaze', 'Shoegaze Wall', 'Electric Guitar', {
    layers: [
      { wave: 'sawtooth', detune: -20, octave: 0, gain: 0.85 },
      { wave: 'sawtooth', detune: 20, octave: 0, gain: 0.85 },
      { wave: 'square', detune: 0, octave: 1, gain: 0.3 },
      { wave: 'sawtooth', detune: 10, octave: -1, gain: 0.4 },
    ],
    filter: { type: 'lowpass', cutoff: 2800, q: 2.5, envAmount: 1.4, envDecay: 0.8, keyTrack: 0.35, velTrack: 0.4 },
    body: { freq: 1400, gain: 6, q: 1.4 },
    amp: { attack: 0.05, decay: 1.8, sustain: 0.75, release: 1.4 },
    noise: 0.18, noiseDecay: 0.03, noiseFreq: 3000,
    drive: 0.8, humanize: 0.15, width: 0.85,
    send: { reverb: 0.8, delay: 0.35, chorus: 0.4 }, volume: 0.38,
  }),
  P('gtr-palm', 'Palm Mute', 'Electric Guitar', {
    layers: [{ wave: 'sawtooth', detune: -4, octave: 0, gain: 1 }, { wave: 'square', detune: 4, octave: 0, gain: 0.5 }],
    filter: { type: 'lowpass', cutoff: 1100, q: 3, envAmount: 3, envDecay: 0.07, keyTrack: 0.4, velTrack: 0.85 },
    body: { freq: 550, gain: 6, q: 2 },
    amp: { attack: 0.002, decay: 0.16, sustain: 0.06, release: 0.1 },
    noise: 0.35, noiseDecay: 0.012, noiseFreq: 2600,
    drive: 0.65, humanize: 0.12, send: { reverb: 0.1 }, volume: 0.6,
  }),
  P('gtr-funk', 'Funk Wah', 'Electric Guitar', {
    layers: [{ wave: 'sawtooth', detune: 0, octave: 0, gain: 1 }, { wave: 'square', detune: 6, octave: 0, gain: 0.4 }],
    filter: { type: 'bandpass', cutoff: 900, q: 8, envAmount: 4.5, envDecay: 0.16, keyTrack: 0.4, velTrack: 1 },
    body: { freq: 2000, gain: 6, q: 3 },
    amp: { attack: 0.003, decay: 0.28, sustain: 0.12, release: 0.2 },
    noise: 0.35, noiseDecay: 0.014, noiseFreq: 3400,
    drive: 0.25, humanize: 0.18, send: { reverb: 0.16 }, volume: 0.65,
  }),
  P('gtr-surf', 'Surf Tremolo', 'Electric Guitar', {
    layers: [{ wave: 'sawtooth', detune: 0, octave: 0, gain: 1 }, { wave: 'triangle', detune: 6, octave: 1, gain: 0.25 }],
    filter: { type: 'lowpass', cutoff: 3000, q: 2.2, envAmount: 2, envDecay: 0.16, keyTrack: 0.5, velTrack: 0.85 },
    body: { freq: 1600, gain: 7, q: 1.6 },
    amp: { attack: 0.003, decay: 1.1, sustain: 0.3, release: 0.45 },
    noise: 0.32, noiseDecay: 0.018, noiseFreq: 3400,
    vibrato: { rate: 5.8, depth: 16 },
    humanize: 0.16, width: 0.3, send: { reverb: 0.6, delay: 0.2 }, volume: 0.65,
  }),
  P('gtr-slide', 'Slide Guitar', 'Electric Guitar', {
    layers: [{ wave: 'sawtooth', detune: 0, octave: 0, gain: 1 }, { wave: 'triangle', detune: 5, octave: 0, gain: 0.4 }],
    filter: { type: 'lowpass', cutoff: 2200, q: 2.4, envAmount: 1.6, envDecay: 0.25, keyTrack: 0.45, velTrack: 0.7 },
    body: { freq: 1300, gain: 8, q: 2.2 },
    amp: { attack: 0.02, decay: 1.3, sustain: 0.45, release: 0.6 },
    noise: 0.14, noiseDecay: 0.03, noiseFreq: 2800,
    drive: 0.35, glide: 0.11, vibrato: { rate: 5, depth: 20 },
    humanize: 0.2, send: { reverb: 0.42, delay: 0.15 }, volume: 0.62,
  }),
  P('gtr-ebow', 'E-Bow Sustain', 'Electric Guitar', {
    layers: [
      { wave: 'sawtooth', detune: -3, octave: 0, gain: 1 },
      { wave: 'sine', detune: 3, octave: 1, gain: 0.35 },
    ],
    filter: { type: 'lowpass', cutoff: 2400, q: 3, envAmount: 2, envDecay: 1.2, keyTrack: 0.4, velTrack: 0.4 },
    body: { freq: 1500, gain: 7, q: 2 },
    amp: { attack: 0.5, decay: 0.8, sustain: 0.9, release: 1.2 },
    drive: 0.4, vibrato: { rate: 4.6, depth: 12 },
    humanize: 0.1, width: 0.4, send: { reverb: 0.6, delay: 0.3 }, volume: 0.5,
  }),
  P('gtr-harmonics', 'Harmonics', 'Electric Guitar', {
    layers: [
      { wave: 'sine', detune: 0, octave: 1, gain: 1 },
      { wave: 'sine', detune: 3, octave: 19 / 12, gain: 0.5 },
      { wave: 'triangle', detune: -3, octave: 2, gain: 0.22 },
    ],
    filter: { type: 'highpass', cutoff: 600, q: 1, envAmount: 0, envDecay: 0.2, keyTrack: 0.4, velTrack: 0.5 },
    amp: { attack: 0.008, decay: 2, sustain: 0.1, release: 1.2 },
    noise: 0.12, noiseDecay: 0.02, noiseFreq: 5000,
    humanize: 0.14, width: 0.35, send: { reverb: 0.55, delay: 0.3 }, volume: 0.6,
  }),
  P('gtr-power', 'Power Chord', 'Electric Guitar', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 1 },
      { wave: 'sawtooth', detune: 5, octave: 7 / 12, gain: 0.85 },
      { wave: 'square', detune: -5, octave: 1, gain: 0.4 },
    ],
    filter: { type: 'lowpass', cutoff: 3200, q: 3, envAmount: 1, envDecay: 0.25, keyTrack: 0.35, velTrack: 0.5 },
    body: { freq: 1000, gain: 8, q: 1.7 },
    amp: { attack: 0.005, decay: 1.3, sustain: 0.65, release: 0.5 },
    noise: 0.25, noiseDecay: 0.016, noiseFreq: 3200,
    drive: 0.85, humanize: 0.1, width: 0.35, send: { reverb: 0.24 }, volume: 0.4,
  }),

  // ══ Acoustic Guitar ═════════════════════════════════════════════════════════
  P('acu-steel', 'Steel String', 'Acoustic Guitar', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 0.75 },
      { wave: 'triangle', detune: 5, octave: 0, gain: 0.6 },
      { wave: 'sine', detune: -5, octave: 1, gain: 0.25 },
    ],
    filter: { type: 'lowpass', cutoff: 3200, q: 1.2, envAmount: 2.2, envDecay: 0.12, keyTrack: 0.6, velTrack: 0.9 },
    body: { freq: 1100, gain: 7, q: 1.1 },
    amp: { attack: 0.003, decay: 1.6, sustain: 0.12, release: 0.7 },
    noise: 0.42, noiseDecay: 0.022, noiseFreq: 3000,
    humanize: 0.22, width: 0.3, send: { reverb: 0.34 }, volume: 0.72,
  }),
  P('acu-nylon', 'Nylon Classical', 'Acoustic Guitar', {
    layers: [
      { wave: 'triangle', detune: 0, octave: 0, gain: 1 },
      { wave: 'sine', detune: 4, octave: 1, gain: 0.3 },
    ],
    filter: { type: 'lowpass', cutoff: 1900, q: 1.1, envAmount: 1.8, envDecay: 0.15, keyTrack: 0.55, velTrack: 0.8 },
    body: { freq: 850, gain: 6, q: 1.3 },
    amp: { attack: 0.006, decay: 1.5, sustain: 0.1, release: 0.65 },
    noise: 0.2, noiseDecay: 0.025, noiseFreq: 2000,
    humanize: 0.24, width: 0.22, send: { reverb: 0.34 }, volume: 0.75,
  }),
  P('acu-12string', '12-String', 'Acoustic Guitar', {
    layers: [
      { wave: 'sawtooth', detune: -9, octave: 0, gain: 0.7 },
      { wave: 'sawtooth', detune: 9, octave: 0, gain: 0.7 },
      { wave: 'triangle', detune: -6, octave: 1, gain: 0.45 },
      { wave: 'triangle', detune: 6, octave: 1, gain: 0.45 },
    ],
    filter: { type: 'lowpass', cutoff: 3600, q: 1.2, envAmount: 2, envDecay: 0.14, keyTrack: 0.6, velTrack: 0.85 },
    body: { freq: 1250, gain: 7, q: 1.1 },
    amp: { attack: 0.004, decay: 1.8, sustain: 0.12, release: 0.85 },
    noise: 0.4, noiseDecay: 0.024, noiseFreq: 3400,
    humanize: 0.26, width: 0.65, send: { reverb: 0.4 }, volume: 0.55,
  }),
  P('acu-folk', 'Folk Strum', 'Acoustic Guitar', {
    layers: [
      { wave: 'sawtooth', detune: -6, octave: 0, gain: 0.8 },
      { wave: 'triangle', detune: 6, octave: 0, gain: 0.6 },
    ],
    filter: { type: 'lowpass', cutoff: 2800, q: 1.4, envAmount: 2, envDecay: 0.1, keyTrack: 0.55, velTrack: 0.9 },
    body: { freq: 1000, gain: 8, q: 1 },
    amp: { attack: 0.003, decay: 1.1, sustain: 0.2, release: 0.55 },
    noise: 0.5, noiseDecay: 0.028, noiseFreq: 2800,
    humanize: 0.26, width: 0.35, send: { reverb: 0.3 }, volume: 0.68,
  }),
  P('acu-bright', 'Bright Strum', 'Acoustic Guitar', {
    layers: [
      { wave: 'sawtooth', detune: -4, octave: 0, gain: 0.85 },
      { wave: 'sawtooth', detune: 4, octave: 0, gain: 0.7 },
      { wave: 'triangle', detune: 0, octave: 1, gain: 0.35 },
    ],
    filter: { type: 'lowpass', cutoff: 4600, q: 1.4, envAmount: 2.4, envDecay: 0.1, keyTrack: 0.6, velTrack: 0.95 },
    body: { freq: 2200, gain: 7, q: 1.5 },
    amp: { attack: 0.002, decay: 1.2, sustain: 0.14, release: 0.55 },
    noise: 0.6, noiseDecay: 0.02, noiseFreq: 4200,
    humanize: 0.24, width: 0.45, send: { reverb: 0.32 }, volume: 0.6,
  }),
  P('acu-picked', 'Picked Acoustic', 'Acoustic Guitar', {
    layers: [{ wave: 'sawtooth', detune: 0, octave: 0, gain: 0.85 }, { wave: 'sine', detune: 6, octave: 1, gain: 0.3 }],
    filter: { type: 'lowpass', cutoff: 3800, q: 1.6, envAmount: 2.6, envDecay: 0.09, keyTrack: 0.6, velTrack: 0.9 },
    body: { freq: 1400, gain: 6, q: 1.3 },
    amp: { attack: 0.002, decay: 1.2, sustain: 0.08, release: 0.6 },
    noise: 0.55, noiseDecay: 0.018, noiseFreq: 3800,
    humanize: 0.2, width: 0.28, send: { reverb: 0.34, delay: 0.12 }, volume: 0.7,
  }),
  P('acu-parlor', 'Parlor Guitar', 'Acoustic Guitar', {
    layers: [{ wave: 'triangle', detune: 0, octave: 0, gain: 1 }, { wave: 'sawtooth', detune: 7, octave: 0, gain: 0.3 }],
    filter: { type: 'lowpass', cutoff: 2400, q: 1.3, envAmount: 1.9, envDecay: 0.12, keyTrack: 0.55, velTrack: 0.85 },
    body: { freq: 1500, gain: 8, q: 1.8 },
    amp: { attack: 0.003, decay: 1.2, sustain: 0.1, release: 0.5 },
    noise: 0.4, noiseDecay: 0.02, noiseFreq: 3000,
    humanize: 0.24, width: 0.22, send: { reverb: 0.3 }, volume: 0.72,
  }),
  P('acu-muted', 'Muted Acoustic', 'Acoustic Guitar', {
    layers: [{ wave: 'triangle', detune: 0, octave: 0, gain: 1 }, { wave: 'sawtooth', detune: 5, octave: 0, gain: 0.25 }],
    filter: { type: 'lowpass', cutoff: 1200, q: 2.2, envAmount: 3, envDecay: 0.06, keyTrack: 0.5, velTrack: 0.9 },
    body: { freq: 700, gain: 6, q: 1.8 },
    amp: { attack: 0.002, decay: 0.28, sustain: 0.04, release: 0.2 },
    noise: 0.5, noiseDecay: 0.014, noiseFreq: 2400,
    humanize: 0.22, send: { reverb: 0.16 }, volume: 0.75,
  }),
  P('acu-dobro', 'Resonator', 'Acoustic Guitar', {
    layers: [
      { wave: 'sawtooth', detune: -4, octave: 0, gain: 0.9 },
      { wave: 'square', detune: 4, octave: 0, gain: 0.35 },
    ],
    filter: { type: 'bandpass', cutoff: 1600, q: 2.2, envAmount: 2.2, envDecay: 0.12, keyTrack: 0.55, velTrack: 0.85 },
    body: { freq: 2100, gain: 9, q: 2.4 },
    amp: { attack: 0.003, decay: 1.3, sustain: 0.14, release: 0.55 },
    noise: 0.45, noiseDecay: 0.02, noiseFreq: 3600,
    drive: 0.2, humanize: 0.22, send: { reverb: 0.36 }, volume: 0.65,
  }),

  // ══ Bass Guitar ═════════════════════════════════════════════════════════════
  P('bgtr-finger', 'Finger Bass', 'Bass Guitar', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 0.8 },
      { wave: 'sine', detune: 0, octave: -1, gain: 0.9 },
    ],
    filter: { type: 'lowpass', cutoff: 700, q: 2, envAmount: 2.4, envDecay: 0.18, keyTrack: 0.4, velTrack: 0.85 },
    body: { freq: 400, gain: 5, q: 1.2 },
    amp: { attack: 0.006, decay: 0.9, sustain: 0.35, release: 0.3 },
    noise: 0.15, noiseDecay: 0.02, noiseFreq: 1600,
    humanize: 0.16, octave: -1, volume: 0.85, send: { reverb: 0.06 },
  }),
  P('bgtr-pick', 'Pick Bass', 'Bass Guitar', {
    layers: [
      { wave: 'sawtooth', detune: -3, octave: 0, gain: 0.9 },
      { wave: 'square', detune: 3, octave: 0, gain: 0.35 },
      { wave: 'sine', detune: 0, octave: -1, gain: 0.7 },
    ],
    filter: { type: 'lowpass', cutoff: 1100, q: 2.5, envAmount: 2.8, envDecay: 0.12, keyTrack: 0.4, velTrack: 0.9 },
    body: { freq: 600, gain: 6, q: 1.5 },
    amp: { attack: 0.003, decay: 0.7, sustain: 0.3, release: 0.25 },
    noise: 0.35, noiseDecay: 0.014, noiseFreq: 2600,
    humanize: 0.14, octave: -1, volume: 0.8, send: { reverb: 0.06 },
  }),
  P('bgtr-slap', 'Slap Bass', 'Bass Guitar', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 0.85 },
      { wave: 'square', detune: 6, octave: 1, gain: 0.25 },
      { wave: 'sine', detune: 0, octave: -1, gain: 0.8 },
    ],
    filter: { type: 'lowpass', cutoff: 900, q: 6, envAmount: 6, envDecay: 0.08, keyTrack: 0.4, velTrack: 1 },
    body: { freq: 800, gain: 7, q: 2 },
    amp: { attack: 0.002, decay: 0.45, sustain: 0.15, release: 0.2 },
    noise: 0.5, noiseDecay: 0.012, noiseFreq: 3200,
    drive: 0.25, humanize: 0.16, octave: -1, volume: 0.75, send: { reverb: 0.08 },
  }),
  P('bgtr-fretless', 'Fretless', 'Bass Guitar', {
    layers: [{ wave: 'triangle', detune: 0, octave: 0, gain: 1 }, { wave: 'sine', detune: 3, octave: -1, gain: 0.85 }],
    filter: { type: 'lowpass', cutoff: 600, q: 1.8, envAmount: 2, envDecay: 0.25, keyTrack: 0.4, velTrack: 0.7 },
    body: { freq: 350, gain: 5, q: 1.1 },
    amp: { attack: 0.02, decay: 1, sustain: 0.45, release: 0.4 },
    vibrato: { rate: 4.5, depth: 12 },
    glide: 0.07, humanize: 0.2, octave: -1, volume: 0.85, send: { reverb: 0.14 },
  }),
  P('bgtr-upright', 'Upright Bass', 'Bass Guitar', {
    layers: [
      { wave: 'triangle', detune: 0, octave: 0, gain: 1 },
      { wave: 'sine', detune: -4, octave: -1, gain: 0.8 },
      { wave: 'sawtooth', detune: 6, octave: 0, gain: 0.14 },
    ],
    filter: { type: 'lowpass', cutoff: 480, q: 1.6, envAmount: 2.6, envDecay: 0.14, keyTrack: 0.4, velTrack: 0.85 },
    body: { freq: 280, gain: 7, q: 1 },
    amp: { attack: 0.008, decay: 0.75, sustain: 0.18, release: 0.35 },
    noise: 0.3, noiseDecay: 0.03, noiseFreq: 1400,
    humanize: 0.3, octave: -1, volume: 0.85, send: { reverb: 0.16 },
  }),
  P('bgtr-overdrive', 'Overdrive Bass', 'Bass Guitar', {
    layers: [
      { wave: 'sawtooth', detune: -5, octave: 0, gain: 1 },
      { wave: 'square', detune: 5, octave: 0, gain: 0.5 },
      { wave: 'sine', detune: 0, octave: -1, gain: 0.75 },
    ],
    filter: { type: 'lowpass', cutoff: 1300, q: 3, envAmount: 2.4, envDecay: 0.15, keyTrack: 0.4, velTrack: 0.8 },
    body: { freq: 700, gain: 6, q: 1.6 },
    amp: { attack: 0.004, decay: 0.8, sustain: 0.4, release: 0.25 },
    noise: 0.28, noiseDecay: 0.014, noiseFreq: 2600,
    drive: 0.7, humanize: 0.12, octave: -1, volume: 0.55, send: { reverb: 0.06 },
  }),
  P('bgtr-flatwound', 'Flatwound', 'Bass Guitar', {
    layers: [{ wave: 'sine', detune: 0, octave: 0, gain: 1 }, { wave: 'triangle', detune: 3, octave: -1, gain: 0.7 }],
    filter: { type: 'lowpass', cutoff: 460, q: 1.4, envAmount: 1.8, envDecay: 0.2, keyTrack: 0.35, velTrack: 0.7 },
    body: { freq: 300, gain: 5, q: 1.2 },
    amp: { attack: 0.008, decay: 0.9, sustain: 0.3, release: 0.3 },
    noise: 0.12, noiseDecay: 0.02, noiseFreq: 1200,
    humanize: 0.16, octave: -1, volume: 0.88, send: { reverb: 0.08 },
  }),
  P('bgtr-muted', 'Muted Bass', 'Bass Guitar', {
    layers: [{ wave: 'sine', detune: 0, octave: 0, gain: 1 }, { wave: 'triangle', detune: 4, octave: 0, gain: 0.35 }],
    filter: { type: 'lowpass', cutoff: 420, q: 2.5, envAmount: 3, envDecay: 0.06, keyTrack: 0.35, velTrack: 0.8 },
    amp: { attack: 0.003, decay: 0.22, sustain: 0.05, release: 0.12 },
    noise: 0.2, noiseDecay: 0.012, noiseFreq: 1400,
    humanize: 0.14, octave: -1, volume: 0.9, send: { reverb: 0.04 },
  }),

  // ══ Strings ═════════════════════════════════════════════════════════════════
  P('orch-strings', 'String Ensemble', 'Strings', {
    layers: [
      { wave: 'sawtooth', detune: -11, octave: 0, gain: 0.75 },
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 0.9 },
      { wave: 'sawtooth', detune: 11, octave: 0, gain: 0.75 },
      { wave: 'triangle', detune: 0, octave: -1, gain: 0.35 },
    ],
    filter: { type: 'lowpass', cutoff: 2800, q: 1, envAmount: 0.7, envDecay: 0.8, keyTrack: 0.4, velTrack: 0.5 },
    amp: { attack: 0.25, decay: 0.6, sustain: 0.9, release: 0.8 },
    vibrato: { rate: 5, depth: 7 },
    humanize: 0.16, width: 0.7, send: { reverb: 0.5 }, volume: 0.5,
  }),
  P('orch-violin', 'Solo Violin', 'Strings', {
    layers: [{ wave: 'sawtooth', detune: 0, octave: 0, gain: 1 }, { wave: 'triangle', detune: 6, octave: 0, gain: 0.35 }],
    filter: { type: 'lowpass', cutoff: 3600, q: 1.8, envAmount: 1, envDecay: 0.5, keyTrack: 0.5, velTrack: 0.65 },
    body: { freq: 2400, gain: 6, q: 2 },
    amp: { attack: 0.12, decay: 0.4, sustain: 0.85, release: 0.4 },
    vibrato: { rate: 6, depth: 16 },
    humanize: 0.22, width: 0.2, send: { reverb: 0.45 }, volume: 0.6,
  }),
  P('str-viola', 'Viola', 'Strings', {
    layers: [{ wave: 'sawtooth', detune: 0, octave: 0, gain: 1 }, { wave: 'triangle', detune: -5, octave: 0, gain: 0.4 }],
    filter: { type: 'lowpass', cutoff: 2400, q: 1.7, envAmount: 1, envDecay: 0.5, keyTrack: 0.45, velTrack: 0.6 },
    body: { freq: 1500, gain: 6, q: 1.8 },
    amp: { attack: 0.14, decay: 0.45, sustain: 0.85, release: 0.45 },
    vibrato: { rate: 5.6, depth: 14 },
    humanize: 0.22, width: 0.2, send: { reverb: 0.45 }, volume: 0.62,
  }),
  P('str-cello', 'Solo Cello', 'Strings', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 1 },
      { wave: 'triangle', detune: 4, octave: 0, gain: 0.45 },
      { wave: 'sine', detune: 0, octave: -1, gain: 0.3 },
    ],
    filter: { type: 'lowpass', cutoff: 1500, q: 1.6, envAmount: 1.2, envDecay: 0.6, keyTrack: 0.45, velTrack: 0.6 },
    body: { freq: 700, gain: 7, q: 1.5 },
    amp: { attack: 0.16, decay: 0.5, sustain: 0.85, release: 0.6 },
    vibrato: { rate: 5.2, depth: 14 },
    humanize: 0.22, width: 0.22, send: { reverb: 0.5 }, volume: 0.66,
  }),
  P('str-doublebass', 'Double Bass', 'Strings', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 0.85 },
      { wave: 'sine', detune: -3, octave: -1, gain: 0.8 },
    ],
    filter: { type: 'lowpass', cutoff: 700, q: 1.6, envAmount: 1.4, envDecay: 0.5, keyTrack: 0.4, velTrack: 0.6 },
    body: { freq: 330, gain: 7, q: 1.2 },
    amp: { attack: 0.14, decay: 0.6, sustain: 0.8, release: 0.6 },
    vibrato: { rate: 4.6, depth: 10 },
    humanize: 0.24, octave: -1, send: { reverb: 0.4 }, volume: 0.7,
  }),
  P('str-tremolo', 'Tremolo Strings', 'Strings', {
    layers: [
      { wave: 'sawtooth', detune: -14, octave: 0, gain: 0.8 },
      { wave: 'sawtooth', detune: 14, octave: 0, gain: 0.8 },
      { wave: 'sawtooth', detune: 0, octave: 1, gain: 0.3 },
    ],
    filter: { type: 'lowpass', cutoff: 3000, q: 1.5, envAmount: 1, envDecay: 0.9, keyTrack: 0.4, velTrack: 0.5 },
    amp: { attack: 0.35, decay: 0.8, sustain: 0.85, release: 0.9 },
    vibrato: { rate: 13, depth: 22 },
    humanize: 0.24, width: 0.8, send: { reverb: 0.65 }, volume: 0.48,
  }),
  P('str-staccato', 'Staccato Strings', 'Strings', {
    layers: [
      { wave: 'sawtooth', detune: -9, octave: 0, gain: 0.85 },
      { wave: 'sawtooth', detune: 9, octave: 0, gain: 0.85 },
    ],
    filter: { type: 'lowpass', cutoff: 2800, q: 2, envAmount: 2.4, envDecay: 0.08, keyTrack: 0.45, velTrack: 0.85 },
    body: { freq: 1600, gain: 5, q: 1.6 },
    amp: { attack: 0.008, decay: 0.24, sustain: 0.05, release: 0.18 },
    noise: 0.2, noiseDecay: 0.016, noiseFreq: 2600,
    humanize: 0.2, width: 0.55, send: { reverb: 0.4 }, volume: 0.6,
  }),
  P('str-chamber', 'Chamber Strings', 'Strings', {
    layers: [
      { wave: 'sawtooth', detune: -6, octave: 0, gain: 0.8 },
      { wave: 'triangle', detune: 6, octave: 0, gain: 0.6 },
      { wave: 'sawtooth', detune: 0, octave: -1, gain: 0.25 },
    ],
    filter: { type: 'lowpass', cutoff: 2200, q: 1.2, envAmount: 0.8, envDecay: 0.9, keyTrack: 0.4, velTrack: 0.5 },
    body: { freq: 1100, gain: 5, q: 1.3 },
    amp: { attack: 0.2, decay: 0.6, sustain: 0.88, release: 0.8 },
    vibrato: { rate: 5.4, depth: 9 },
    humanize: 0.2, width: 0.6, send: { reverb: 0.55 }, volume: 0.55,
  }),
  P('orch-pizzicato', 'Pizzicato', 'Strings', {
    layers: [{ wave: 'sawtooth', detune: 0, octave: 0, gain: 1 }, { wave: 'triangle', detune: 7, octave: 0, gain: 0.4 }],
    filter: { type: 'lowpass', cutoff: 2600, q: 2, envAmount: 3, envDecay: 0.06, keyTrack: 0.55, velTrack: 0.9 },
    body: { freq: 1400, gain: 6, q: 1.8 },
    amp: { attack: 0.002, decay: 0.35, sustain: 0.02, release: 0.2 },
    noise: 0.3, noiseDecay: 0.014, noiseFreq: 2800,
    humanize: 0.2, width: 0.3, send: { reverb: 0.36 }, volume: 0.72,
  }),

  // ══ Brass ═══════════════════════════════════════════════════════════════════
  P('orch-brass', 'Brass Section', 'Brass', {
    layers: [
      { wave: 'sawtooth', detune: -6, octave: 0, gain: 0.9 },
      { wave: 'sawtooth', detune: 6, octave: 0, gain: 0.9 },
      { wave: 'square', detune: 0, octave: -1, gain: 0.3 },
    ],
    filter: { type: 'lowpass', cutoff: 1600, q: 2.5, envAmount: 3, envDecay: 0.25, keyTrack: 0.45, velTrack: 0.9 },
    body: { freq: 1200, gain: 6, q: 1.6 },
    amp: { attack: 0.06, decay: 0.35, sustain: 0.85, release: 0.35 },
    drive: 0.25, humanize: 0.16, width: 0.5, send: { reverb: 0.35 }, volume: 0.55,
  }),
  P('brass-trumpet', 'Trumpet', 'Brass', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 1 },
      { wave: 'square', detune: 5, octave: 0, gain: 0.25 },
    ],
    filter: { type: 'lowpass', cutoff: 2200, q: 3, envAmount: 3.5, envDecay: 0.18, keyTrack: 0.5, velTrack: 0.95 },
    body: { freq: 1800, gain: 8, q: 2.2 },
    amp: { attack: 0.04, decay: 0.28, sustain: 0.85, release: 0.25 },
    noise: 0.14, noiseDecay: 0.05, noiseFreq: 4000,
    drive: 0.3, vibrato: { rate: 5.6, depth: 9 },
    humanize: 0.18, send: { reverb: 0.35 }, volume: 0.6,
  }),
  P('brass-muted-trumpet', 'Muted Trumpet', 'Brass', {
    layers: [{ wave: 'sawtooth', detune: 0, octave: 0, gain: 1 }, { wave: 'square', detune: 8, octave: 0, gain: 0.35 }],
    filter: { type: 'bandpass', cutoff: 1500, q: 4.5, envAmount: 3, envDecay: 0.16, keyTrack: 0.5, velTrack: 0.85 },
    body: { freq: 2600, gain: 10, q: 4 },
    amp: { attack: 0.03, decay: 0.25, sustain: 0.8, release: 0.22 },
    drive: 0.35, vibrato: { rate: 5.4, depth: 10 },
    humanize: 0.18, send: { reverb: 0.3 }, volume: 0.6,
  }),
  P('brass-flugel', 'Flugelhorn', 'Brass', {
    layers: [{ wave: 'triangle', detune: 0, octave: 0, gain: 1 }, { wave: 'sawtooth', detune: 4, octave: 0, gain: 0.45 }],
    filter: { type: 'lowpass', cutoff: 1500, q: 2.2, envAmount: 2.6, envDecay: 0.22, keyTrack: 0.45, velTrack: 0.8 },
    body: { freq: 1000, gain: 6, q: 1.6 },
    amp: { attack: 0.07, decay: 0.3, sustain: 0.85, release: 0.35 },
    noise: 0.1, noiseDecay: 0.06, noiseFreq: 3000,
    vibrato: { rate: 5, depth: 8 },
    humanize: 0.18, send: { reverb: 0.42 }, volume: 0.62,
  }),
  P('brass-trombone', 'Trombone', 'Brass', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 1 },
      { wave: 'square', detune: -4, octave: -1, gain: 0.3 },
    ],
    filter: { type: 'lowpass', cutoff: 1300, q: 2.6, envAmount: 3, envDecay: 0.22, keyTrack: 0.45, velTrack: 0.9 },
    body: { freq: 800, gain: 7, q: 1.8 },
    amp: { attack: 0.06, decay: 0.32, sustain: 0.85, release: 0.3 },
    drive: 0.3, glide: 0.05, vibrato: { rate: 4.8, depth: 8 },
    humanize: 0.2, send: { reverb: 0.38 }, volume: 0.62,
  }),
  P('brass-tuba', 'Tuba', 'Brass', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 0.9 },
      { wave: 'sine', detune: 0, octave: -1, gain: 0.8 },
    ],
    filter: { type: 'lowpass', cutoff: 620, q: 2, envAmount: 2.4, envDecay: 0.25, keyTrack: 0.4, velTrack: 0.75 },
    body: { freq: 300, gain: 7, q: 1.4 },
    amp: { attack: 0.08, decay: 0.35, sustain: 0.85, release: 0.35 },
    drive: 0.2, humanize: 0.2, octave: -1, send: { reverb: 0.32 }, volume: 0.72,
  }),
  P('orch-horn', 'French Horn', 'Brass', {
    layers: [{ wave: 'triangle', detune: 0, octave: 0, gain: 1 }, { wave: 'sawtooth', detune: 4, octave: 0, gain: 0.4 }],
    filter: { type: 'lowpass', cutoff: 1200, q: 2, envAmount: 2, envDecay: 0.35, keyTrack: 0.4, velTrack: 0.75 },
    body: { freq: 800, gain: 5, q: 1.4 },
    amp: { attack: 0.1, decay: 0.4, sustain: 0.85, release: 0.5 },
    humanize: 0.18, width: 0.3, send: { reverb: 0.5 }, volume: 0.65,
  }),
  P('brass-stab', 'Brass Stab', 'Brass', {
    layers: [
      { wave: 'sawtooth', detune: -8, octave: 0, gain: 1 },
      { wave: 'sawtooth', detune: 8, octave: 0, gain: 0.9 },
      { wave: 'square', detune: 0, octave: 1, gain: 0.3 },
    ],
    filter: { type: 'lowpass', cutoff: 1900, q: 3.5, envAmount: 4, envDecay: 0.1, keyTrack: 0.45, velTrack: 1 },
    body: { freq: 1400, gain: 7, q: 2 },
    amp: { attack: 0.01, decay: 0.3, sustain: 0.1, release: 0.2 },
    drive: 0.4, humanize: 0.12, width: 0.5, send: { reverb: 0.28 }, volume: 0.5,
  }),

  // ══ Woodwind ════════════════════════════════════════════════════════════════
  P('orch-flute', 'Flute', 'Woodwind', {
    layers: [{ wave: 'sine', detune: 0, octave: 0, gain: 1 }, { wave: 'triangle', detune: 4, octave: 1, gain: 0.15 }],
    filter: { type: 'lowpass', cutoff: 3600, q: 1, envAmount: 0.8, envDecay: 0.3, keyTrack: 0.5, velTrack: 0.5 },
    amp: { attack: 0.07, decay: 0.25, sustain: 0.85, release: 0.3 },
    noise: 0.25, noiseDecay: 0.35, noiseFreq: 5000,
    vibrato: { rate: 5.5, depth: 10 },
    humanize: 0.18, send: { reverb: 0.45 }, volume: 0.7,
  }),
  P('wind-piccolo', 'Piccolo', 'Woodwind', {
    layers: [{ wave: 'sine', detune: 0, octave: 1, gain: 1 }, { wave: 'triangle', detune: 6, octave: 2, gain: 0.12 }],
    filter: { type: 'highpass', cutoff: 800, q: 1, envAmount: 0.6, envDecay: 0.25, keyTrack: 0.5, velTrack: 0.5 },
    amp: { attack: 0.05, decay: 0.2, sustain: 0.85, release: 0.22 },
    noise: 0.3, noiseDecay: 0.3, noiseFreq: 7000,
    vibrato: { rate: 6, depth: 12 },
    humanize: 0.18, send: { reverb: 0.42 }, volume: 0.55,
  }),
  P('wind-panflute', 'Pan Flute', 'Woodwind', {
    layers: [{ wave: 'sine', detune: 0, octave: 0, gain: 1 }, { wave: 'sine', detune: 9, octave: 1, gain: 0.2 }],
    filter: { type: 'bandpass', cutoff: 1600, q: 1.6, envAmount: 1, envDecay: 0.2, keyTrack: 0.55, velTrack: 0.5 },
    amp: { attack: 0.05, decay: 0.3, sustain: 0.7, release: 0.35 },
    noise: 0.55, noiseDecay: 0.14, noiseFreq: 3600,
    vibrato: { rate: 4.8, depth: 12 },
    humanize: 0.24, send: { reverb: 0.6 }, volume: 0.62,
  }),
  P('wind-clarinet', 'Clarinet', 'Woodwind', {
    layers: [
      { wave: 'square', detune: 0, octave: 0, gain: 1 },
      { wave: 'sine', detune: 0, octave: 19 / 12, gain: 0.2 },
    ],
    filter: { type: 'lowpass', cutoff: 1700, q: 1.8, envAmount: 1.4, envDecay: 0.25, keyTrack: 0.5, velTrack: 0.7 },
    body: { freq: 1100, gain: 5, q: 1.6 },
    amp: { attack: 0.05, decay: 0.25, sustain: 0.88, release: 0.25 },
    noise: 0.14, noiseDecay: 0.09, noiseFreq: 3200,
    vibrato: { rate: 4.6, depth: 6 },
    humanize: 0.18, send: { reverb: 0.38 }, volume: 0.65,
  }),
  P('wind-oboe', 'Oboe', 'Woodwind', {
    layers: [{ wave: 'sawtooth', detune: 0, octave: 0, gain: 1 }, { wave: 'square', detune: 7, octave: 0, gain: 0.3 }],
    filter: { type: 'bandpass', cutoff: 1500, q: 3.2, envAmount: 1.8, envDecay: 0.22, keyTrack: 0.5, velTrack: 0.7 },
    body: { freq: 2500, gain: 9, q: 3 },
    amp: { attack: 0.05, decay: 0.25, sustain: 0.85, release: 0.25 },
    vibrato: { rate: 5.6, depth: 12 },
    humanize: 0.2, send: { reverb: 0.4 }, volume: 0.58,
  }),
  P('wind-bassoon', 'Bassoon', 'Woodwind', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 1 },
      { wave: 'triangle', detune: -5, octave: -1, gain: 0.5 },
    ],
    filter: { type: 'lowpass', cutoff: 900, q: 2.4, envAmount: 2, envDecay: 0.25, keyTrack: 0.45, velTrack: 0.7 },
    body: { freq: 480, gain: 8, q: 2 },
    amp: { attack: 0.06, decay: 0.3, sustain: 0.85, release: 0.3 },
    noise: 0.12, noiseDecay: 0.08, noiseFreq: 2000,
    vibrato: { rate: 4.6, depth: 8 },
    humanize: 0.2, octave: -1, send: { reverb: 0.38 }, volume: 0.68,
  }),
  P('wind-alto-sax', 'Alto Sax', 'Woodwind', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 1 },
      { wave: 'square', detune: 6, octave: 0, gain: 0.35 },
    ],
    filter: { type: 'bandpass', cutoff: 1300, q: 2.6, envAmount: 3, envDecay: 0.2, keyTrack: 0.5, velTrack: 0.9 },
    body: { freq: 1700, gain: 8, q: 2.4 },
    amp: { attack: 0.04, decay: 0.3, sustain: 0.85, release: 0.3 },
    noise: 0.2, noiseDecay: 0.05, noiseFreq: 3600,
    drive: 0.3, vibrato: { rate: 5.4, depth: 14 },
    humanize: 0.22, send: { reverb: 0.4 }, volume: 0.6,
  }),
  P('wind-tenor-sax', 'Tenor Sax', 'Woodwind', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 1 },
      { wave: 'square', detune: -6, octave: 0, gain: 0.4 },
      { wave: 'sine', detune: 0, octave: -1, gain: 0.25 },
    ],
    filter: { type: 'bandpass', cutoff: 950, q: 2.4, envAmount: 3, envDecay: 0.22, keyTrack: 0.5, velTrack: 0.9 },
    body: { freq: 1300, gain: 8, q: 2.2 },
    amp: { attack: 0.045, decay: 0.32, sustain: 0.85, release: 0.35 },
    noise: 0.24, noiseDecay: 0.06, noiseFreq: 3000,
    drive: 0.35, vibrato: { rate: 5, depth: 14 },
    humanize: 0.24, send: { reverb: 0.42 }, volume: 0.6,
  }),

  // ══ Mallets ═════════════════════════════════════════════════════════════════
  P('pluck-marimba', 'Marimba', 'Mallets', {
    layers: [{ wave: 'sine', detune: 0, octave: 0, gain: 1 }, { wave: 'sine', detune: 0, octave: 2, gain: 0.2 }],
    filter: { type: 'lowpass', cutoff: 3400, q: 1, envAmount: 1.2, envDecay: 0.08, keyTrack: 0.5, velTrack: 0.7 },
    body: { freq: 800, gain: 5, q: 1.4 },
    amp: { attack: 0.002, decay: 0.7, sustain: 0.02, release: 0.35 },
    humanize: 0.12, send: { reverb: 0.32 }, volume: 0.75,
  }),
  P('mal-vibraphone', 'Vibraphone', 'Mallets', {
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'sine', detune: 3, octave: 2, gain: 0.24 },
      { wave: 'triangle', detune: -3, octave: 1, gain: 0.12 },
    ],
    filter: { type: 'lowpass', cutoff: 4200, q: 1, envAmount: 1, envDecay: 0.12, keyTrack: 0.5, velTrack: 0.6 },
    amp: { attack: 0.003, decay: 2.2, sustain: 0.1, release: 1.6 },
    vibrato: { rate: 5.5, depth: 5 },
    humanize: 0.1, width: 0.35, send: { reverb: 0.48 }, volume: 0.68,
  }),
  P('mal-xylophone', 'Xylophone', 'Mallets', {
    layers: [{ wave: 'sine', detune: 0, octave: 1, gain: 1 }, { wave: 'square', detune: 5, octave: 2, gain: 0.12 }],
    filter: { type: 'bandpass', cutoff: 2800, q: 1.4, envAmount: 1.6, envDecay: 0.05, keyTrack: 0.55, velTrack: 0.8 },
    body: { freq: 3000, gain: 7, q: 2 },
    amp: { attack: 0.001, decay: 0.32, sustain: 0.01, release: 0.18 },
    noise: 0.2, noiseDecay: 0.008, noiseFreq: 5000,
    humanize: 0.14, send: { reverb: 0.3 }, volume: 0.7,
  }),
  P('mal-glockenspiel', 'Glockenspiel', 'Mallets', {
    layers: [
      { wave: 'sine', detune: 0, octave: 2, gain: 1 },
      { wave: 'sine', detune: 9, octave: 31 / 12, gain: 0.24 },
    ],
    filter: { type: 'highpass', cutoff: 1400, q: 1, envAmount: 0, envDecay: 0.2, keyTrack: 0.4, velTrack: 0.55 },
    amp: { attack: 0.001, decay: 1.6, sustain: 0.02, release: 1.3 },
    humanize: 0.1, width: 0.3, send: { reverb: 0.5 }, volume: 0.5,
  }),
  P('mal-tubular', 'Tubular Bells', 'Mallets', {
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'sine', detune: 5, octave: 19 / 12, gain: 0.45 },
      { wave: 'sine', detune: -8, octave: 26 / 12, gain: 0.3 },
      { wave: 'triangle', detune: 12, octave: 2, gain: 0.14 },
    ],
    filter: { type: 'lowpass', cutoff: 5000, q: 1.2, envAmount: 0.8, envDecay: 0.4, keyTrack: 0.45, velTrack: 0.6 },
    amp: { attack: 0.004, decay: 3.5, sustain: 0.06, release: 3 },
    humanize: 0.1, width: 0.4, send: { reverb: 0.7 }, volume: 0.5,
  }),
  P('mal-steeldrum', 'Steel Drum', 'Mallets', {
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'triangle', detune: 7, octave: 1, gain: 0.4 },
      { wave: 'sine', detune: -11, octave: 19 / 12, gain: 0.25 },
    ],
    filter: { type: 'bandpass', cutoff: 1800, q: 2, envAmount: 2, envDecay: 0.1, keyTrack: 0.5, velTrack: 0.8 },
    body: { freq: 2400, gain: 8, q: 2.4 },
    amp: { attack: 0.002, decay: 0.9, sustain: 0.04, release: 0.5 },
    noise: 0.22, noiseDecay: 0.01, noiseFreq: 4000,
    humanize: 0.18, width: 0.3, send: { reverb: 0.4 }, volume: 0.65,
  }),
  P('mal-timpani', 'Timpani', 'Mallets', {
    layers: [
      { wave: 'sine', detune: 0, octave: -1, gain: 1 },
      { wave: 'triangle', detune: 6, octave: 0, gain: 0.28 },
    ],
    filter: { type: 'lowpass', cutoff: 700, q: 1.6, envAmount: 2.4, envDecay: 0.12, keyTrack: 0.35, velTrack: 0.85 },
    body: { freq: 200, gain: 7, q: 1.2 },
    amp: { attack: 0.003, decay: 1.6, sustain: 0.04, release: 0.9 },
    noise: 0.3, noiseDecay: 0.02, noiseFreq: 900,
    humanize: 0.16, send: { reverb: 0.55 }, volume: 0.8,
  }),

  // ══ Plucked ═════════════════════════════════════════════════════════════════
  P('pluck-harp', 'Harp', 'Plucked', {
    layers: [{ wave: 'triangle', detune: 0, octave: 0, gain: 1 }, { wave: 'sine', detune: 4, octave: 1, gain: 0.3 }],
    filter: { type: 'lowpass', cutoff: 4000, q: 1, envAmount: 1.8, envDecay: 0.12, keyTrack: 0.6, velTrack: 0.8 },
    amp: { attack: 0.003, decay: 2, sustain: 0.05, release: 1.1 },
    noise: 0.15, noiseDecay: 0.018, noiseFreq: 3000,
    humanize: 0.16, width: 0.35, send: { reverb: 0.5 }, volume: 0.7,
  }),
  P('pluck-koto', 'Koto', 'Plucked', {
    layers: [{ wave: 'sawtooth', detune: 0, octave: 0, gain: 0.8 }, { wave: 'triangle', detune: 7, octave: 1, gain: 0.35 }],
    filter: { type: 'bandpass', cutoff: 1500, q: 2, envAmount: 3, envDecay: 0.1, keyTrack: 0.65, velTrack: 0.85 },
    body: { freq: 2200, gain: 7, q: 2.5 },
    amp: { attack: 0.002, decay: 1.4, sustain: 0.06, release: 0.7 },
    noise: 0.4, noiseDecay: 0.02, noiseFreq: 3500,
    humanize: 0.2, send: { reverb: 0.4 }, volume: 0.68,
  }),
  P('pluck-sitar', 'Sitar', 'Plucked', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 0.9 },
      { wave: 'sawtooth', detune: 22, octave: 0, gain: 0.4 },
      { wave: 'square', detune: -15, octave: 1, gain: 0.25 },
    ],
    filter: { type: 'bandpass', cutoff: 2000, q: 3, envAmount: 3.5, envDecay: 0.14, keyTrack: 0.6, velTrack: 0.85 },
    body: { freq: 3000, gain: 9, q: 3 },
    amp: { attack: 0.003, decay: 1.8, sustain: 0.12, release: 0.9 },
    noise: 0.45, noiseDecay: 0.025, noiseFreq: 4000,
    humanize: 0.22, width: 0.3, send: { reverb: 0.45 }, volume: 0.6,
  }),
  P('pluck-banjo', 'Banjo', 'Plucked', {
    layers: [{ wave: 'sawtooth', detune: 0, octave: 0, gain: 1 }, { wave: 'square', detune: 8, octave: 1, gain: 0.3 }],
    filter: { type: 'highpass', cutoff: 400, q: 1.4, envAmount: 2, envDecay: 0.08, keyTrack: 0.6, velTrack: 0.9 },
    body: { freq: 2600, gain: 8, q: 2.2 },
    amp: { attack: 0.001, decay: 0.75, sustain: 0.05, release: 0.35 },
    noise: 0.55, noiseDecay: 0.014, noiseFreq: 4200,
    humanize: 0.24, send: { reverb: 0.28 }, volume: 0.62,
  }),
  P('pluck-mandolin', 'Mandolin', 'Plucked', {
    layers: [
      { wave: 'sawtooth', detune: -10, octave: 1, gain: 0.75 },
      { wave: 'sawtooth', detune: 10, octave: 1, gain: 0.75 },
    ],
    filter: { type: 'lowpass', cutoff: 4200, q: 1.6, envAmount: 2.2, envDecay: 0.1, keyTrack: 0.6, velTrack: 0.9 },
    body: { freq: 2000, gain: 7, q: 1.8 },
    amp: { attack: 0.002, decay: 0.9, sustain: 0.07, release: 0.4 },
    noise: 0.45, noiseDecay: 0.016, noiseFreq: 3800,
    humanize: 0.24, width: 0.4, send: { reverb: 0.35 }, volume: 0.6,
  }),
  P('pluck-ukulele', 'Ukulele', 'Plucked', {
    layers: [{ wave: 'triangle', detune: 0, octave: 1, gain: 1 }, { wave: 'sawtooth', detune: 8, octave: 1, gain: 0.3 }],
    filter: { type: 'lowpass', cutoff: 3400, q: 1.4, envAmount: 2.4, envDecay: 0.1, keyTrack: 0.6, velTrack: 0.9 },
    body: { freq: 2000, gain: 8, q: 2 },
    amp: { attack: 0.002, decay: 0.7, sustain: 0.05, release: 0.35 },
    noise: 0.45, noiseDecay: 0.016, noiseFreq: 3200,
    humanize: 0.26, send: { reverb: 0.3 }, volume: 0.68,
  }),
  P('pluck-dulcimer', 'Hammered Dulcimer', 'Plucked', {
    layers: [
      { wave: 'triangle', detune: -8, octave: 0, gain: 0.8 },
      { wave: 'triangle', detune: 8, octave: 0, gain: 0.8 },
      { wave: 'sine', detune: 0, octave: 1, gain: 0.3 },
    ],
    filter: { type: 'lowpass', cutoff: 3600, q: 1.3, envAmount: 2, envDecay: 0.1, keyTrack: 0.6, velTrack: 0.85 },
    body: { freq: 1600, gain: 7, q: 1.6 },
    amp: { attack: 0.002, decay: 1.5, sustain: 0.05, release: 0.9 },
    noise: 0.3, noiseDecay: 0.012, noiseFreq: 3400,
    humanize: 0.2, width: 0.45, send: { reverb: 0.5 }, volume: 0.6,
  }),
  P('pluck-kalimba', 'Kalimba', 'Plucked', {
    layers: [{ wave: 'sine', detune: 0, octave: 0, gain: 1 }, { wave: 'triangle', detune: 5, octave: 19 / 12, gain: 0.28 }],
    filter: { type: 'lowpass', cutoff: 3000, q: 1.2, envAmount: 1.5, envDecay: 0.1, keyTrack: 0.55, velTrack: 0.7 },
    body: { freq: 1300, gain: 6, q: 1.6 },
    amp: { attack: 0.002, decay: 1, sustain: 0.04, release: 0.6 },
    noise: 0.2, noiseDecay: 0.012, noiseFreq: 2600,
    humanize: 0.18, send: { reverb: 0.4 }, volume: 0.72,
  }),

  // ══ Vocal ═══════════════════════════════════════════════════════════════════
  P('voc-aah', 'Choir Aahs', 'Vocal', {
    layers: [
      { wave: 'sawtooth', detune: -12, octave: 0, gain: 0.7 },
      { wave: 'triangle', detune: 0, octave: 0, gain: 0.9 },
      { wave: 'sawtooth', detune: 12, octave: 0, gain: 0.7 },
      { wave: 'sine', detune: 0, octave: 1, gain: 0.2 },
    ],
    filter: { type: 'bandpass', cutoff: 900, q: 1.4, envAmount: 0.8, envDecay: 1, keyTrack: 0.6, velTrack: 0.4 },
    body: { freq: 2600, gain: 8, q: 1.6 },
    amp: { attack: 0.35, decay: 0.7, sustain: 0.88, release: 1 },
    vibrato: { rate: 5, depth: 11 },
    humanize: 0.2, width: 0.7, send: { reverb: 0.7 }, volume: 0.55,
  }),
  P('voc-ooh', 'Choir Oohs', 'Vocal', {
    layers: [
      { wave: 'sine', detune: -10, octave: 0, gain: 0.9 },
      { wave: 'triangle', detune: 10, octave: 0, gain: 0.7 },
      { wave: 'sine', detune: 0, octave: -1, gain: 0.3 },
    ],
    filter: { type: 'lowpass', cutoff: 800, q: 2.2, envAmount: 0.6, envDecay: 1.2, keyTrack: 0.55, velTrack: 0.35 },
    body: { freq: 500, gain: 7, q: 2 },
    amp: { attack: 0.45, decay: 0.8, sustain: 0.88, release: 1.2 },
    vibrato: { rate: 4.6, depth: 9 },
    humanize: 0.2, width: 0.7, send: { reverb: 0.75 }, volume: 0.6,
  }),
  P('voc-solo', 'Solo Voice', 'Vocal', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 1 },
      { wave: 'triangle', detune: 5, octave: 0, gain: 0.35 },
    ],
    filter: { type: 'bandpass', cutoff: 1000, q: 2.4, envAmount: 1.4, envDecay: 0.5, keyTrack: 0.6, velTrack: 0.6 },
    body: { freq: 2900, gain: 10, q: 3 },
    amp: { attack: 0.12, decay: 0.4, sustain: 0.85, release: 0.5 },
    noise: 0.12, noiseDecay: 0.08, noiseFreq: 4000,
    vibrato: { rate: 5.6, depth: 18 },
    humanize: 0.26, send: { reverb: 0.55, delay: 0.14 }, volume: 0.6,
  }),
  P('voc-pad', 'Vocal Pad', 'Vocal', {
    layers: [
      { wave: 'triangle', detune: -16, octave: 0, gain: 0.8 },
      { wave: 'triangle', detune: 16, octave: 0, gain: 0.8 },
      { wave: 'sine', detune: 0, octave: 1, gain: 0.25 },
    ],
    filter: { type: 'bandpass', cutoff: 1200, q: 1.8, envAmount: 1, envDecay: 2, keyTrack: 0.5, velTrack: 0.3 },
    body: { freq: 2200, gain: 7, q: 1.8 },
    amp: { attack: 1.2, decay: 1.5, sustain: 0.85, release: 2.2 },
    vibrato: { rate: 3.4, depth: 12 },
    humanize: 0.16, width: 0.85, send: { reverb: 0.85, chorus: 0.4 }, volume: 0.5,
  }),
  P('voc-vocoder', 'Vocoder Vox', 'Vocal', {
    layers: [
      { wave: 'sawtooth', detune: -7, octave: 0, gain: 0.9 },
      { wave: 'square', detune: 7, octave: 0, gain: 0.6 },
      { wave: 'sawtooth', detune: 0, octave: 1, gain: 0.25 },
    ],
    filter: { type: 'bandpass', cutoff: 1400, q: 5, envAmount: 2.4, envDecay: 0.5, keyTrack: 0.55, velTrack: 0.5 },
    body: { freq: 2400, gain: 11, q: 5 },
    amp: { attack: 0.05, decay: 0.4, sustain: 0.85, release: 0.4 },
    drive: 0.3, width: 0.6, send: { reverb: 0.4, chorus: 0.4, delay: 0.2 }, volume: 0.5,
  }),

  // ══ World ═══════════════════════════════════════════════════════════════════
  P('wld-erhu', 'Erhu', 'World', {
    layers: [{ wave: 'sawtooth', detune: 0, octave: 0, gain: 1 }, { wave: 'triangle', detune: 6, octave: 0, gain: 0.35 }],
    filter: { type: 'bandpass', cutoff: 1300, q: 3, envAmount: 1.6, envDecay: 0.4, keyTrack: 0.55, velTrack: 0.7 },
    body: { freq: 2100, gain: 9, q: 2.8 },
    amp: { attack: 0.09, decay: 0.4, sustain: 0.85, release: 0.4 },
    glide: 0.06, vibrato: { rate: 6.2, depth: 22 },
    humanize: 0.26, send: { reverb: 0.45 }, volume: 0.6,
  }),
  P('wld-shamisen', 'Shamisen', 'World', {
    layers: [{ wave: 'sawtooth', detune: 0, octave: 0, gain: 1 }, { wave: 'square', detune: 9, octave: 0, gain: 0.3 }],
    filter: { type: 'bandpass', cutoff: 1700, q: 2.4, envAmount: 3.4, envDecay: 0.09, keyTrack: 0.6, velTrack: 0.9 },
    body: { freq: 2800, gain: 9, q: 2.6 },
    amp: { attack: 0.001, decay: 0.8, sustain: 0.04, release: 0.4 },
    noise: 0.6, noiseDecay: 0.015, noiseFreq: 3800,
    humanize: 0.24, send: { reverb: 0.34 }, volume: 0.62,
  }),
  P('wld-oud', 'Oud', 'World', {
    layers: [
      { wave: 'sawtooth', detune: -7, octave: 0, gain: 0.85 },
      { wave: 'triangle', detune: 7, octave: 0, gain: 0.6 },
    ],
    filter: { type: 'lowpass', cutoff: 2000, q: 1.8, envAmount: 2.4, envDecay: 0.12, keyTrack: 0.55, velTrack: 0.85 },
    body: { freq: 900, gain: 8, q: 1.6 },
    amp: { attack: 0.002, decay: 1.2, sustain: 0.08, release: 0.55 },
    noise: 0.4, noiseDecay: 0.02, noiseFreq: 2600,
    humanize: 0.26, width: 0.3, send: { reverb: 0.4 }, volume: 0.68,
  }),
  P('wld-bouzouki', 'Bouzouki', 'World', {
    layers: [
      { wave: 'sawtooth', detune: -12, octave: 0, gain: 0.8 },
      { wave: 'sawtooth', detune: 12, octave: 0, gain: 0.8 },
      { wave: 'triangle', detune: 0, octave: 1, gain: 0.3 },
    ],
    filter: { type: 'lowpass', cutoff: 3800, q: 1.6, envAmount: 2.4, envDecay: 0.1, keyTrack: 0.6, velTrack: 0.9 },
    body: { freq: 2200, gain: 8, q: 2 },
    amp: { attack: 0.002, decay: 1, sustain: 0.06, release: 0.45 },
    noise: 0.5, noiseDecay: 0.016, noiseFreq: 3800,
    humanize: 0.26, width: 0.5, send: { reverb: 0.36 }, volume: 0.58,
  }),
  P('wld-hang', 'Hang Drum', 'World', {
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'sine', detune: 6, octave: 19 / 12, gain: 0.3 },
      { wave: 'triangle', detune: -6, octave: 1, gain: 0.2 },
    ],
    filter: { type: 'lowpass', cutoff: 2200, q: 1.6, envAmount: 1.6, envDecay: 0.1, keyTrack: 0.5, velTrack: 0.7 },
    body: { freq: 1200, gain: 7, q: 2.2 },
    amp: { attack: 0.003, decay: 1.6, sustain: 0.04, release: 1.2 },
    noise: 0.18, noiseDecay: 0.014, noiseFreq: 2200,
    humanize: 0.18, width: 0.4, send: { reverb: 0.6 }, volume: 0.7,
  }),
  P('wld-didgeridoo', 'Didgeridoo', 'World', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: -1, gain: 1 },
      { wave: 'square', detune: 11, octave: -1, gain: 0.35 },
    ],
    filter: { type: 'bandpass', cutoff: 340, q: 4, envAmount: 2.6, envDecay: 0.6, keyTrack: 0.25, velTrack: 0.5 },
    body: { freq: 900, gain: 9, q: 3 },
    amp: { attack: 0.09, decay: 0.5, sustain: 0.88, release: 0.4 },
    noise: 0.2, noiseDecay: 0.4, noiseFreq: 1400,
    drive: 0.35, vibrato: { rate: 7.5, depth: 28 },
    humanize: 0.24, octave: -1, send: { reverb: 0.4 }, volume: 0.6,
  }),
  P('wld-bagpipe', 'Bagpipe', 'World', {
    layers: [
      { wave: 'sawtooth', detune: -4, octave: 0, gain: 1 },
      { wave: 'square', detune: 4, octave: 0, gain: 0.5 },
      { wave: 'sawtooth', detune: 0, octave: -1, gain: 0.4 },
    ],
    filter: { type: 'bandpass', cutoff: 1500, q: 3.4, envAmount: 1, envDecay: 0.3, keyTrack: 0.45, velTrack: 0.4 },
    body: { freq: 2400, gain: 9, q: 3 },
    amp: { attack: 0.04, decay: 0.15, sustain: 0.95, release: 0.15 },
    drive: 0.3, vibrato: { rate: 5, depth: 8 },
    humanize: 0.16, width: 0.3, send: { reverb: 0.4 }, volume: 0.5,
  }),

  // ══ FX ══════════════════════════════════════════════════════════════════════
  P('fx-sweep', 'Sci-Fi Sweep', 'FX', {
    layers: [{ wave: 'sawtooth', detune: -20, octave: 0, gain: 0.8 }, { wave: 'sawtooth', detune: 20, octave: 1, gain: 0.6 }],
    filter: { type: 'bandpass', cutoff: 300, q: 9, envAmount: 20, envDecay: 1.6, keyTrack: 0.2, velTrack: 0.4 },
    amp: { attack: 0.4, decay: 1.5, sustain: 0.5, release: 1.2 },
    width: 0.7, send: { reverb: 0.6, delay: 0.4 }, volume: 0.5,
  }),
  P('fx-riser', 'Riser', 'FX', {
    layers: [{ wave: 'sawtooth', detune: -25, octave: 0, gain: 0.7 }, { wave: 'square', detune: 25, octave: 1, gain: 0.4 }],
    filter: { type: 'highpass', cutoff: 200, q: 5, envAmount: 30, envDecay: 2.5, keyTrack: 0.1, velTrack: 0.3 },
    amp: { attack: 1.5, decay: 0.5, sustain: 0.9, release: 0.3 },
    noise: 0.4, noiseDecay: 2, noiseFreq: 5000,
    width: 0.8, send: { reverb: 0.6, delay: 0.3 }, volume: 0.45,
  }),
  P('fx-impact', 'Impact', 'FX', {
    layers: [
      { wave: 'sine', detune: 0, octave: -2, gain: 1 },
      { wave: 'sawtooth', detune: -30, octave: -1, gain: 0.5 },
      { wave: 'square', detune: 30, octave: 0, gain: 0.2 },
    ],
    filter: { type: 'lowpass', cutoff: 900, q: 3, envAmount: 6, envDecay: 0.25, keyTrack: 0.2, velTrack: 0.6 },
    amp: { attack: 0.002, decay: 1.8, sustain: 0.02, release: 1.4 },
    noise: 0.5, noiseDecay: 0.3, noiseFreq: 1200,
    drive: 0.5, width: 0.6, send: { reverb: 0.8, delay: 0.2 }, volume: 0.6,
  }),
  P('fx-noise-sweep', 'Noise Sweep', 'FX', {
    // A wide, inharmonic saw cluster stands in for sustained noise: the noise
    // generator here is a transient and dies away before the sweep is heard.
    layers: [
      { wave: 'sawtooth', detune: -47, octave: 1, gain: 0.6 },
      { wave: 'sawtooth', detune: 38, octave: 1 + 1 / 12, gain: 0.6 },
      { wave: 'square', detune: 13, octave: 1 + 6 / 12, gain: 0.4 },
      { wave: 'sawtooth', detune: -21, octave: 2 + 2 / 12, gain: 0.4 },
    ],
    filter: { type: 'bandpass', cutoff: 600, q: 4, envAmount: 16, envDecay: 2, keyTrack: 0.15, velTrack: 0.4 },
    amp: { attack: 0.8, decay: 1.4, sustain: 0.6, release: 1 },
    noise: 1, noiseDecay: 2.4, noiseFreq: 3000,
    width: 0.75, send: { reverb: 0.65, delay: 0.35 }, volume: 0.85,
  }),
  P('fx-drone', 'Metallic Drone', 'FX', {
    layers: [
      { wave: 'square', detune: -30, octave: -1, gain: 0.7 },
      { wave: 'sawtooth', detune: 30, octave: 0, gain: 0.5 },
      { wave: 'square', detune: 11, octave: 19 / 12, gain: 0.3 },
    ],
    filter: { type: 'bandpass', cutoff: 1400, q: 6, envAmount: 1, envDecay: 3, keyTrack: 0.3, velTrack: 0.3 },
    body: { freq: 3200, gain: 10, q: 4 },
    amp: { attack: 0.8, decay: 2, sustain: 0.8, release: 2.5 },
    drive: 0.35, width: 0.7, send: { reverb: 0.7, delay: 0.3 }, volume: 0.45,
  }),
  P('fx-vinyl', 'Vinyl Crackle', 'FX', {
    layers: [{ wave: 'sine', detune: 0, octave: -1, gain: 0.08 }],
    filter: { type: 'highpass', cutoff: 1800, q: 1.2, envAmount: 0, envDecay: 0.5, keyTrack: 0.1, velTrack: 0.3 },
    amp: { attack: 0.05, decay: 0.5, sustain: 0.6, release: 0.6 },
    noise: 1, noiseDecay: 3, noiseFreq: 4000,
    send: { reverb: 0.2 }, volume: 0.3,
  }),
  P('fx-chime', 'Wind Chime', 'FX', {
    layers: [
      { wave: 'sine', detune: 0, octave: 1, gain: 1 },
      { wave: 'sine', detune: 13, octave: 26 / 12, gain: 0.4 },
      { wave: 'sine', detune: -13, octave: 31 / 12, gain: 0.22 },
    ],
    filter: { type: 'highpass', cutoff: 1200, q: 1, envAmount: 0, envDecay: 0.5, keyTrack: 0.4, velTrack: 0.5 },
    amp: { attack: 0.004, decay: 2.5, sustain: 0.05, release: 2 },
    humanize: 0.3, width: 0.7, send: { reverb: 0.8, delay: 0.4 }, volume: 0.55,
  }),
  P('fx-zap', 'Laser Zap', 'FX', {
    layers: [{ wave: 'sawtooth', detune: 0, octave: 2, gain: 1 }],
    filter: { type: 'lowpass', cutoff: 6000, q: 8, envAmount: 0, envDecay: 0.1, keyTrack: 0.4, velTrack: 0.5 },
    amp: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.08 },
    glide: 0.15, drive: 0.4, send: { reverb: 0.3, delay: 0.35 }, volume: 0.55,
  }),
  // ══ Genre essentials: phonk and deep house ════════════════════════════════════
  P('mal-cowbell-808', '808 Cowbell', 'Mallets', {
    // The 808's cowbell is two square waves a fifth-and-a-bit apart (≈ 540 and
    // 800 Hz) through a band-pass. Played as notes it becomes the drift-phonk lead.
    layers: [
      { wave: 'square', detune: 0, octave: 0, gain: 0.8 },
      { wave: 'square', detune: 0, octave: 0.5884, gain: 0.75 },
    ],
    filter: { type: 'bandpass', cutoff: 1500, q: 0.8, envAmount: 0.5, envDecay: 0.05, keyTrack: 0.7, velTrack: 0.5 },
    amp: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 },
    noise: 0.06, noiseDecay: 0.005, noiseFreq: 5000,
    humanize: 0.04, send: { reverb: 0.14, delay: 0.1 }, volume: 1,
  }),
  P('bass-808-glide', '808 Glide', 'Synth Bass', {
    // A long sine 808 with a click, saturation for presence on small speakers,
    // and a quick slide from note to note
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'triangle', detune: 0, octave: 1, gain: 0.15 },
    ],
    filter: { type: 'lowpass', cutoff: 1100, q: 0.8, envAmount: 1, envDecay: 0.08, keyTrack: 0.5, velTrack: 0.5 },
    amp: { attack: 0.003, decay: 1.8, sustain: 0.5, release: 0.22 },
    noise: 0.12, noiseDecay: 0.01, noiseFreq: 1800,
    drive: 0.5, glide: 0.045, send: { reverb: 0 }, volume: 0.85,
  }),
  P('keys-house-organ', 'House Organ', 'Organ', {
    // The bright, short organ stab of early-90s deep house
    layers: [
      { wave: 'square', detune: 0, octave: 0, gain: 0.45 },
      { wave: 'sine', detune: 0, octave: 1, gain: 0.6 },
      { wave: 'sine', detune: 3, octave: 1 + 7 / 12, gain: 0.3 },
      { wave: 'triangle', detune: 0, octave: -1, gain: 0.3 },
    ],
    filter: { type: 'lowpass', cutoff: 2600, q: 1.4, envAmount: 1.6, envDecay: 0.12, keyTrack: 0.4, velTrack: 0.7 },
    body: { freq: 900, gain: 3, q: 1 },
    amp: { attack: 0.002, decay: 0.32, sustain: 0.3, release: 0.12 },
    noise: 0.1, noiseDecay: 0.008, noiseFreq: 3000,
    width: 0.3, send: { reverb: 0.18, delay: 0.12, chorus: 0.25 }, volume: 0.55,
  }),
  P('fx-trap-hat', 'Trap Hat (playable)', 'FX', {
    // A closed hi-hat you play from the piano roll, for 1/32 and triplet rolls
    // the 16-step drum grid can't express. Built like the 808's: six square
    // oscillators at inharmonic ratios through a high-pass, plus a little noise.
    // Play it around C5; pitch shifts the colour, velocity the bite.
    layers: [
      { wave: 'square', detune: 0, octave: 0, gain: 0.5 },
      { wave: 'square', detune: 0, octave: 0.568, gain: 0.5 },
      { wave: 'square', detune: 0, octave: 0.848, gain: 0.5 },
      { wave: 'square', detune: 0, octave: 1.348, gain: 0.5 },
      { wave: 'square', detune: 0, octave: 1.395, gain: 0.5 },
      { wave: 'square', detune: 0, octave: 1.963, gain: 0.5 },
    ],
    filter: { type: 'highpass', cutoff: 7500, q: 0.9, envAmount: 0, envDecay: 0.05, keyTrack: 0, velTrack: 0 },
    amp: { attack: 0.001, decay: 0.045, sustain: 0, release: 0.025 },
    noise: 0.6, noiseDecay: 0.03, noiseFreq: 10000,
    humanize: 0.12, send: { reverb: 0.04 }, volume: 0.8,
  }),

  // ══ Expansion: orchestral, world, choir and texture instruments ═════════════
  // ── Strings ──
  P('str-legato-violins', 'Legato Violins', 'Strings', {
    layers: [
      { wave: 'sawtooth', detune: -9, octave: 0, gain: 0.8 },
      { wave: 'sawtooth', detune: 7, octave: 0, gain: 0.8 },
      { wave: 'triangle', detune: 0, octave: 1, gain: 0.2 },
    ],
    filter: { type: 'lowpass', cutoff: 3000, q: 1.2, envAmount: 0.8, envDecay: 0.8, keyTrack: 0.5, velTrack: 0.6 },
    body: { freq: 2400, gain: 5, q: 1.4 },
    amp: { attack: 0.22, decay: 0.6, sustain: 0.9, release: 0.7 },
    glide: 0.05, vibrato: { rate: 5.6, depth: 12 },
    humanize: 0.2, width: 0.65, send: { reverb: 0.55 }, volume: 0.55,
  }),
  P('str-spiccato', 'Spiccato Ensemble', 'Strings', {
    layers: [
      { wave: 'sawtooth', detune: -6, octave: 0, gain: 0.9 },
      { wave: 'sawtooth', detune: 6, octave: 0, gain: 0.9 },
    ],
    filter: { type: 'lowpass', cutoff: 2600, q: 1.4, envAmount: 2, envDecay: 0.08, keyTrack: 0.5, velTrack: 0.85 },
    body: { freq: 1400, gain: 6, q: 1.6 },
    amp: { attack: 0.004, decay: 0.16, sustain: 0.05, release: 0.12 },
    noise: 0.2, noiseDecay: 0.02, noiseFreq: 3800,
    humanize: 0.24, width: 0.6, send: { reverb: 0.4 }, volume: 0.62,
  }),
  P('str-cello-section', 'Cello Section', 'Strings', {
    layers: [
      { wave: 'sawtooth', detune: -7, octave: 0, gain: 0.85 },
      { wave: 'sawtooth', detune: 8, octave: 0, gain: 0.85 },
      { wave: 'sine', detune: 0, octave: -1, gain: 0.3 },
    ],
    filter: { type: 'lowpass', cutoff: 1300, q: 1.4, envAmount: 1, envDecay: 0.7, keyTrack: 0.45, velTrack: 0.6 },
    body: { freq: 600, gain: 6, q: 1.3 },
    amp: { attack: 0.2, decay: 0.6, sustain: 0.88, release: 0.8 },
    vibrato: { rate: 5, depth: 10 },
    humanize: 0.2, width: 0.5, send: { reverb: 0.5 }, volume: 0.6,
  }),
  P('str-harmonics', 'String Harmonics', 'Strings', {
    layers: [
      { wave: 'sine', detune: -4, octave: 1, gain: 0.9 },
      { wave: 'sine', detune: 5, octave: 1, gain: 0.9 },
      { wave: 'triangle', detune: 0, octave: 2, gain: 0.2 },
    ],
    filter: { type: 'highpass', cutoff: 500, q: 0.8, envAmount: 0, envDecay: 0.5, keyTrack: 0.3, velTrack: 0.3 },
    amp: { attack: 0.4, decay: 0.8, sustain: 0.85, release: 1.4 },
    vibrato: { rate: 4.8, depth: 6 },
    humanize: 0.15, width: 0.8, send: { reverb: 0.75, chorus: 0.2 }, volume: 0.5,
  }),
  P('str-fiddle', 'Folk Fiddle', 'Strings', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 1 },
      { wave: 'square', detune: 5, octave: 0, gain: 0.18 },
    ],
    filter: { type: 'bandpass', cutoff: 1800, q: 1.6, envAmount: 1.6, envDecay: 0.2, keyTrack: 0.55, velTrack: 0.8 },
    body: { freq: 2800, gain: 8, q: 2.2 },
    amp: { attack: 0.03, decay: 0.3, sustain: 0.8, release: 0.25 },
    noise: 0.18, noiseDecay: 0.05, noiseFreq: 4500,
    glide: 0.03, vibrato: { rate: 6.2, depth: 14 },
    humanize: 0.3, send: { reverb: 0.3 }, volume: 0.6,
  }),
  P('str-sul-pont', 'Sul Ponticello', 'Strings', {
    layers: [
      { wave: 'sawtooth', detune: -10, octave: 0, gain: 0.7 },
      { wave: 'sawtooth', detune: 10, octave: 0, gain: 0.7 },
      { wave: 'square', detune: 0, octave: 1, gain: 0.25 },
    ],
    filter: { type: 'highpass', cutoff: 900, q: 2.5, envAmount: 0, envDecay: 0.5, keyTrack: 0.5, velTrack: 0.4 },
    body: { freq: 4200, gain: 9, q: 3 },
    amp: { attack: 0.3, decay: 0.6, sustain: 0.85, release: 0.9 },
    vibrato: { rate: 7.5, depth: 5 },
    humanize: 0.25, width: 0.7, send: { reverb: 0.6 }, volume: 0.45,
  }),

  // ── Brass ──
  P('brass-cornet', 'Cornet', 'Brass', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 0.9 },
      { wave: 'triangle', detune: 4, octave: 0, gain: 0.4 },
    ],
    filter: { type: 'lowpass', cutoff: 1800, q: 2.2, envAmount: 2.8, envDecay: 0.2, keyTrack: 0.5, velTrack: 0.9 },
    body: { freq: 1300, gain: 6, q: 1.8 },
    amp: { attack: 0.035, decay: 0.3, sustain: 0.82, release: 0.22 },
    noise: 0.1, noiseDecay: 0.05, noiseFreq: 3200,
    drive: 0.15, vibrato: { rate: 5.4, depth: 8 },
    humanize: 0.18, send: { reverb: 0.32 }, volume: 0.62,
  }),
  P('brass-euphonium', 'Euphonium', 'Brass', {
    layers: [
      { wave: 'triangle', detune: 0, octave: 0, gain: 1 },
      { wave: 'sawtooth', detune: 3, octave: 0, gain: 0.35 },
      { wave: 'sine', detune: 0, octave: -1, gain: 0.3 },
    ],
    filter: { type: 'lowpass', cutoff: 1100, q: 1.4, envAmount: 1.8, envDecay: 0.3, keyTrack: 0.45, velTrack: 0.8 },
    body: { freq: 500, gain: 5, q: 1.2 },
    amp: { attack: 0.06, decay: 0.35, sustain: 0.85, release: 0.35 },
    noise: 0.08, noiseDecay: 0.06, noiseFreq: 1800,
    vibrato: { rate: 4.8, depth: 6 }, octave: -1,
    humanize: 0.16, send: { reverb: 0.42 }, volume: 0.66,
  }),
  P('brass-bass-trombone', 'Bass Trombone', 'Brass', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 1 },
      { wave: 'square', detune: -4, octave: 0, gain: 0.25 },
    ],
    filter: { type: 'lowpass', cutoff: 900, q: 2.4, envAmount: 3, envDecay: 0.25, keyTrack: 0.45, velTrack: 0.95 },
    body: { freq: 420, gain: 6, q: 1.6 },
    amp: { attack: 0.05, decay: 0.3, sustain: 0.85, release: 0.3 },
    noise: 0.12, noiseDecay: 0.06, noiseFreq: 1500,
    drive: 0.25, glide: 0.04, octave: -1,
    humanize: 0.18, send: { reverb: 0.36 }, volume: 0.62,
  }),
  P('brass-soft', 'Soft Brass Choir', 'Brass', {
    layers: [
      { wave: 'sawtooth', detune: -8, octave: 0, gain: 0.7 },
      { wave: 'sawtooth', detune: 8, octave: 0, gain: 0.7 },
      { wave: 'triangle', detune: 0, octave: -1, gain: 0.4 },
    ],
    filter: { type: 'lowpass', cutoff: 1200, q: 1.2, envAmount: 1.4, envDecay: 0.6, keyTrack: 0.45, velTrack: 0.7 },
    body: { freq: 800, gain: 4, q: 1.2 },
    amp: { attack: 0.18, decay: 0.5, sustain: 0.85, release: 0.6 },
    vibrato: { rate: 4.6, depth: 5 },
    humanize: 0.15, width: 0.55, send: { reverb: 0.55 }, volume: 0.55,
  }),
  P('brass-mariachi', 'Mariachi Trumpets', 'Brass', {
    layers: [
      { wave: 'sawtooth', detune: -11, octave: 0, gain: 0.85 },
      { wave: 'sawtooth', detune: 11, octave: 0, gain: 0.85 },
    ],
    filter: { type: 'lowpass', cutoff: 2600, q: 2.6, envAmount: 3.2, envDecay: 0.16, keyTrack: 0.5, velTrack: 0.95 },
    body: { freq: 1900, gain: 8, q: 2.2 },
    amp: { attack: 0.03, decay: 0.25, sustain: 0.8, release: 0.22 },
    noise: 0.14, noiseDecay: 0.04, noiseFreq: 4200,
    drive: 0.3, vibrato: { rate: 6.8, depth: 16 },
    humanize: 0.25, width: 0.5, send: { reverb: 0.35 }, volume: 0.55,
  }),

  // ── Woodwind ──
  P('wind-soprano-sax', 'Soprano Sax', 'Woodwind', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 0.8 },
      { wave: 'square', detune: 3, octave: 0, gain: 0.35 },
    ],
    filter: { type: 'bandpass', cutoff: 1700, q: 1.4, envAmount: 1.6, envDecay: 0.2, keyTrack: 0.55, velTrack: 0.85 },
    body: { freq: 2600, gain: 7, q: 2 },
    amp: { attack: 0.04, decay: 0.25, sustain: 0.85, release: 0.22 },
    noise: 0.2, noiseDecay: 0.08, noiseFreq: 4200,
    drive: 0.2, glide: 0.03, vibrato: { rate: 5.4, depth: 12 },
    humanize: 0.22, send: { reverb: 0.38 }, volume: 0.6,
  }),
  P('wind-bari-sax', 'Baritone Sax', 'Woodwind', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 1 },
      { wave: 'square', detune: -4, octave: 0, gain: 0.4 },
    ],
    filter: { type: 'lowpass', cutoff: 1100, q: 2, envAmount: 2.4, envDecay: 0.2, keyTrack: 0.5, velTrack: 0.9 },
    body: { freq: 650, gain: 7, q: 1.6 },
    amp: { attack: 0.03, decay: 0.25, sustain: 0.85, release: 0.2 },
    noise: 0.2, noiseDecay: 0.07, noiseFreq: 2400,
    drive: 0.35, octave: -1, vibrato: { rate: 5, depth: 8 },
    humanize: 0.22, send: { reverb: 0.3 }, volume: 0.62,
  }),
  P('wind-bass-clarinet', 'Bass Clarinet', 'Woodwind', {
    layers: [
      { wave: 'square', detune: 0, octave: 0, gain: 1 },
      { wave: 'sine', detune: 0, octave: -1, gain: 0.3 },
    ],
    filter: { type: 'lowpass', cutoff: 900, q: 1.6, envAmount: 1.2, envDecay: 0.3, keyTrack: 0.45, velTrack: 0.6 },
    body: { freq: 520, gain: 5, q: 1.4 },
    amp: { attack: 0.05, decay: 0.3, sustain: 0.9, release: 0.3 },
    noise: 0.12, noiseDecay: 0.1, noiseFreq: 1800,
    octave: -1, vibrato: { rate: 4.2, depth: 4 },
    humanize: 0.16, send: { reverb: 0.4 }, volume: 0.66,
  }),
  P('wind-english-horn', 'English Horn', 'Woodwind', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 0.7 },
      { wave: 'square', detune: 2, octave: 0, gain: 0.3 },
    ],
    filter: { type: 'bandpass', cutoff: 1100, q: 1.5, envAmount: 1.2, envDecay: 0.3, keyTrack: 0.5, velTrack: 0.6 },
    body: { freq: 1500, gain: 8, q: 2.4 },
    amp: { attack: 0.06, decay: 0.3, sustain: 0.88, release: 0.3 },
    noise: 0.12, noiseDecay: 0.08, noiseFreq: 3000,
    vibrato: { rate: 5, depth: 8 },
    humanize: 0.2, send: { reverb: 0.48 }, volume: 0.85,
  }),
  P('wind-recorder', 'Recorder', 'Woodwind', {
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'triangle', detune: 0, octave: 1, gain: 0.12 },
    ],
    filter: { type: 'lowpass', cutoff: 3000, q: 0.8, envAmount: 0.6, envDecay: 0.2, keyTrack: 0.5, velTrack: 0.4 },
    amp: { attack: 0.03, decay: 0.2, sustain: 0.9, release: 0.12 },
    noise: 0.22, noiseDecay: 0.06, noiseFreq: 5200,
    vibrato: { rate: 5, depth: 3 }, octave: 1,
    humanize: 0.15, send: { reverb: 0.32 }, volume: 0.62,
  }),
  P('wind-shakuhachi', 'Shakuhachi', 'Woodwind', {
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'triangle', detune: 7, octave: 1, gain: 0.12 },
    ],
    filter: { type: 'lowpass', cutoff: 2600, q: 1.2, envAmount: 1.4, envDecay: 0.5, keyTrack: 0.5, velTrack: 0.7 },
    amp: { attack: 0.12, decay: 0.5, sustain: 0.8, release: 0.5 },
    noise: 0.45, noiseDecay: 0.5, noiseFreq: 3800,
    glide: 0.08, vibrato: { rate: 4.4, depth: 16 },
    humanize: 0.3, send: { reverb: 0.65, delay: 0.15 }, volume: 0.62,
  }),
  P('wind-tin-whistle', 'Tin Whistle', 'Woodwind', {
    layers: [
      { wave: 'sine', detune: 0, octave: 1, gain: 1 },
      { wave: 'square', detune: 3, octave: 1, gain: 0.06 },
    ],
    filter: { type: 'lowpass', cutoff: 6000, q: 0.8, envAmount: 0.4, envDecay: 0.1, keyTrack: 0.5, velTrack: 0.4 },
    amp: { attack: 0.015, decay: 0.15, sustain: 0.88, release: 0.08 },
    noise: 0.2, noiseDecay: 0.04, noiseFreq: 6500,
    glide: 0.02, vibrato: { rate: 6, depth: 10 },
    humanize: 0.25, send: { reverb: 0.3 }, volume: 0.55,
  }),
  P('wind-ocarina', 'Ocarina', 'Woodwind', {
    layers: [{ wave: 'sine', detune: 0, octave: 0, gain: 1 }],
    filter: { type: 'lowpass', cutoff: 2200, q: 0.7, envAmount: 0.4, envDecay: 0.2, keyTrack: 0.4, velTrack: 0.4 },
    body: { freq: 900, gain: 3, q: 1 },
    amp: { attack: 0.05, decay: 0.3, sustain: 0.85, release: 0.2 },
    noise: 0.16, noiseDecay: 0.12, noiseFreq: 3400,
    vibrato: { rate: 5.2, depth: 7 }, octave: 1,
    humanize: 0.18, send: { reverb: 0.5 }, volume: 0.66,
  }),
  P('wind-harmonica', 'Harmonica', 'Woodwind', {
    layers: [
      { wave: 'square', detune: -6, octave: 0, gain: 0.6 },
      { wave: 'sawtooth', detune: 6, octave: 0, gain: 0.5 },
    ],
    filter: { type: 'bandpass', cutoff: 1600, q: 1.8, envAmount: 1.2, envDecay: 0.2, keyTrack: 0.5, velTrack: 0.8 },
    body: { freq: 2200, gain: 7, q: 2 },
    amp: { attack: 0.03, decay: 0.3, sustain: 0.8, release: 0.15 },
    noise: 0.15, noiseDecay: 0.06, noiseFreq: 3000,
    drive: 0.2, glide: 0.04, vibrato: { rate: 6.5, depth: 12 },
    humanize: 0.28, send: { reverb: 0.25 }, volume: 0.55,
  }),

  // ── Mallets & bells ──
  P('mal-crotales', 'Crotales', 'Mallets', {
    layers: [
      { wave: 'sine', detune: 0, octave: 2, gain: 1 },
      { wave: 'sine', detune: 8, octave: 2 + 7 / 12, gain: 0.3 },
      { wave: 'sine', detune: -6, octave: 3, gain: 0.15 },
    ],
    filter: { type: 'highpass', cutoff: 1000, q: 0.8, envAmount: 0, envDecay: 0.5, keyTrack: 0.4, velTrack: 0.5 },
    amp: { attack: 0.001, decay: 3, sustain: 0.02, release: 2.4 },
    noise: 0.1, noiseDecay: 0.006, noiseFreq: 8000,
    humanize: 0.1, width: 0.4, send: { reverb: 0.6 }, volume: 0.5,
  }),
  P('mal-handbells', 'Handbells', 'Mallets', {
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'sine', detune: 4, octave: 1, gain: 0.35 },
      { wave: 'sine', detune: -9, octave: 1 + 7 / 12, gain: 0.2 },
    ],
    filter: { type: 'lowpass', cutoff: 5000, q: 0.8, envAmount: 0.8, envDecay: 0.1, keyTrack: 0.5, velTrack: 0.6 },
    amp: { attack: 0.002, decay: 2.4, sustain: 0.06, release: 1.8 },
    vibrato: { rate: 3.5, depth: 3 },
    humanize: 0.18, width: 0.5, send: { reverb: 0.55 }, volume: 0.6,
  }),
  P('mal-bass-marimba', 'Bass Marimba', 'Mallets', {
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'sine', detune: 0, octave: 2, gain: 0.18 },
    ],
    filter: { type: 'lowpass', cutoff: 1400, q: 1.2, envAmount: 1.6, envDecay: 0.06, keyTrack: 0.5, velTrack: 0.7 },
    body: { freq: 300, gain: 6, q: 1.4 },
    amp: { attack: 0.002, decay: 0.9, sustain: 0.02, release: 0.5 },
    noise: 0.2, noiseDecay: 0.012, noiseFreq: 1200,
    octave: -1, humanize: 0.14, send: { reverb: 0.3 }, volume: 0.78,
  }),
  P('mal-church-bell', 'Church Bell', 'Mallets', {
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'sine', detune: 0, octave: -1, gain: 0.5 },
      { wave: 'sine', detune: 15, octave: 3 / 12, gain: 0.4 },   // the bell's minor third
      { wave: 'sine', detune: -10, octave: 1 + 7 / 12, gain: 0.25 },
    ],
    filter: { type: 'lowpass', cutoff: 3600, q: 1, envAmount: 1, envDecay: 0.2, keyTrack: 0.4, velTrack: 0.5 },
    amp: { attack: 0.002, decay: 4, sustain: 0.04, release: 3.5 },
    noise: 0.15, noiseDecay: 0.02, noiseFreq: 2000,
    humanize: 0.08, width: 0.4, send: { reverb: 0.7 }, volume: 0.5,
  }),

  // ── Plucked ──
  P('pluck-guzheng', 'Guzheng', 'Plucked', {
    layers: [
      { wave: 'triangle', detune: 0, octave: 0, gain: 1 },
      { wave: 'sawtooth', detune: 4, octave: 0, gain: 0.2 },
      { wave: 'sine', detune: -3, octave: 1, gain: 0.25 },
    ],
    filter: { type: 'lowpass', cutoff: 3800, q: 1.4, envAmount: 2, envDecay: 0.14, keyTrack: 0.6, velTrack: 0.85 },
    body: { freq: 1500, gain: 6, q: 1.8 },
    amp: { attack: 0.002, decay: 2.2, sustain: 0.04, release: 1 },
    noise: 0.2, noiseDecay: 0.015, noiseFreq: 3400,
    glide: 0.05, vibrato: { rate: 5.5, depth: 14 },
    humanize: 0.2, width: 0.3, send: { reverb: 0.5 }, volume: 0.66,
  }),
  P('pluck-pipa', 'Pipa', 'Plucked', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 0.7 },
      { wave: 'triangle', detune: 5, octave: 0, gain: 0.6 },
    ],
    filter: { type: 'lowpass', cutoff: 3000, q: 2, envAmount: 2.6, envDecay: 0.08, keyTrack: 0.6, velTrack: 0.9 },
    body: { freq: 2000, gain: 8, q: 2.4 },
    amp: { attack: 0.001, decay: 0.8, sustain: 0.03, release: 0.4 },
    noise: 0.3, noiseDecay: 0.01, noiseFreq: 4200,
    humanize: 0.22, send: { reverb: 0.35 }, volume: 0.62,
  }),
  P('pluck-lute', 'Lute', 'Plucked', {
    layers: [
      { wave: 'triangle', detune: -5, octave: 0, gain: 0.8 },
      { wave: 'triangle', detune: 5, octave: 0, gain: 0.8 },   // paired courses
      { wave: 'sine', detune: 0, octave: 1, gain: 0.2 },
    ],
    filter: { type: 'lowpass', cutoff: 2400, q: 1.2, envAmount: 1.8, envDecay: 0.12, keyTrack: 0.55, velTrack: 0.8 },
    body: { freq: 420, gain: 6, q: 1.2 },
    amp: { attack: 0.002, decay: 1.4, sustain: 0.04, release: 0.6 },
    noise: 0.18, noiseDecay: 0.012, noiseFreq: 2600,
    humanize: 0.22, width: 0.3, send: { reverb: 0.42 }, volume: 0.68,
  }),
  P('pluck-zither', 'Zither', 'Plucked', {
    layers: [
      { wave: 'sawtooth', detune: -3, octave: 0, gain: 0.5 },
      { wave: 'triangle', detune: 3, octave: 0, gain: 0.8 },
      { wave: 'sine', detune: 7, octave: 1, gain: 0.3 },
    ],
    filter: { type: 'lowpass', cutoff: 4200, q: 1.4, envAmount: 1.8, envDecay: 0.15, keyTrack: 0.6, velTrack: 0.8 },
    body: { freq: 2400, gain: 5, q: 2 },
    amp: { attack: 0.001, decay: 2.6, sustain: 0.03, release: 1.4 },
    noise: 0.2, noiseDecay: 0.01, noiseFreq: 5000,
    humanize: 0.18, width: 0.4, send: { reverb: 0.5 }, volume: 0.6,
  }),
  P('pluck-autoharp', 'Autoharp', 'Plucked', {
    layers: [
      { wave: 'triangle', detune: -8, octave: 0, gain: 0.8 },
      { wave: 'sawtooth', detune: 8, octave: 0, gain: 0.3 },
      { wave: 'triangle', detune: 0, octave: 1, gain: 0.35 },
    ],
    filter: { type: 'lowpass', cutoff: 3600, q: 1, envAmount: 1.6, envDecay: 0.2, keyTrack: 0.55, velTrack: 0.7 },
    body: { freq: 900, gain: 4, q: 1.2 },
    amp: { attack: 0.004, decay: 2.4, sustain: 0.05, release: 1.4 },
    noise: 0.16, noiseDecay: 0.02, noiseFreq: 3600,
    humanize: 0.2, width: 0.55, send: { reverb: 0.5, chorus: 0.2 }, volume: 0.62,
  }),
  P('pluck-cimbalom', 'Cimbalom', 'Plucked', {
    layers: [
      { wave: 'triangle', detune: -6, octave: 0, gain: 0.8 },
      { wave: 'triangle', detune: 6, octave: 0, gain: 0.8 },
      { wave: 'square', detune: 0, octave: 1, gain: 0.12 },
    ],
    filter: { type: 'lowpass', cutoff: 3200, q: 1.6, envAmount: 2.2, envDecay: 0.1, keyTrack: 0.6, velTrack: 0.9 },
    body: { freq: 1200, gain: 6, q: 1.8 },
    amp: { attack: 0.001, decay: 2, sustain: 0.05, release: 1.2 },
    noise: 0.32, noiseDecay: 0.008, noiseFreq: 2400,
    humanize: 0.2, width: 0.4, send: { reverb: 0.42 }, volume: 0.62,
  }),
  P('pluck-balalaika', 'Balalaika', 'Plucked', {
    layers: [
      { wave: 'sawtooth', detune: -4, octave: 0, gain: 0.6 },
      { wave: 'triangle', detune: 4, octave: 0, gain: 0.7 },
    ],
    filter: { type: 'lowpass', cutoff: 3400, q: 1.8, envAmount: 2.4, envDecay: 0.07, keyTrack: 0.6, velTrack: 0.9 },
    body: { freq: 1700, gain: 7, q: 2 },
    amp: { attack: 0.001, decay: 0.6, sustain: 0.04, release: 0.3 },
    noise: 0.26, noiseDecay: 0.01, noiseFreq: 3800,
    humanize: 0.25, send: { reverb: 0.3 }, volume: 0.62,
  }),

  // ── World ──
  P('wld-duduk', 'Duduk', 'World', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 0.6 },
      { wave: 'sine', detune: 3, octave: 0, gain: 0.7 },
    ],
    filter: { type: 'lowpass', cutoff: 1300, q: 1.8, envAmount: 1, envDecay: 0.4, keyTrack: 0.5, velTrack: 0.6 },
    body: { freq: 900, gain: 7, q: 2 },
    amp: { attack: 0.1, decay: 0.4, sustain: 0.88, release: 0.5 },
    noise: 0.15, noiseDecay: 0.15, noiseFreq: 2200,
    glide: 0.07, vibrato: { rate: 4.6, depth: 12 },
    humanize: 0.25, send: { reverb: 0.6 }, volume: 0.66,
  }),
  P('wld-ney', 'Ney Flute', 'World', {
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'triangle', detune: -6, octave: 1, gain: 0.1 },
    ],
    filter: { type: 'lowpass', cutoff: 2200, q: 1, envAmount: 0.8, envDecay: 0.6, keyTrack: 0.5, velTrack: 0.6 },
    amp: { attack: 0.14, decay: 0.5, sustain: 0.82, release: 0.6 },
    noise: 0.55, noiseDecay: 0.6, noiseFreq: 3000,
    glide: 0.09, vibrato: { rate: 4.8, depth: 14 },
    humanize: 0.3, send: { reverb: 0.65 }, volume: 0.6,
  }),
  P('wld-kora', 'Kora', 'World', {
    layers: [
      { wave: 'triangle', detune: 0, octave: 0, gain: 1 },
      { wave: 'sine', detune: 3, octave: 1, gain: 0.35 },
      { wave: 'sawtooth', detune: -4, octave: 0, gain: 0.12 },
    ],
    filter: { type: 'lowpass', cutoff: 3200, q: 1.4, envAmount: 2, envDecay: 0.12, keyTrack: 0.6, velTrack: 0.85 },
    body: { freq: 700, gain: 7, q: 1.6 },   // the calabash
    amp: { attack: 0.002, decay: 1.6, sustain: 0.04, release: 0.9 },
    noise: 0.2, noiseDecay: 0.012, noiseFreq: 3000,
    humanize: 0.2, width: 0.35, send: { reverb: 0.45 }, volume: 0.66,
  }),
  P('wld-santoor', 'Santoor', 'World', {
    layers: [
      { wave: 'triangle', detune: -9, octave: 0, gain: 0.7 },
      { wave: 'triangle', detune: 9, octave: 0, gain: 0.7 },
      { wave: 'sine', detune: 0, octave: 1, gain: 0.35 },
      { wave: 'sine', detune: 5, octave: 2, gain: 0.1 },
    ],
    filter: { type: 'lowpass', cutoff: 4600, q: 1.2, envAmount: 1.8, envDecay: 0.1, keyTrack: 0.6, velTrack: 0.85 },
    amp: { attack: 0.001, decay: 2.4, sustain: 0.04, release: 1.6 },
    noise: 0.28, noiseDecay: 0.006, noiseFreq: 5200,
    humanize: 0.18, width: 0.5, send: { reverb: 0.55 }, volume: 0.58,
  }),
  P('wld-gamelan', 'Gamelan Gong Chime', 'World', {
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'sine', detune: 22, octave: 0, gain: 0.6 },    // paired, deliberately beating
      { wave: 'sine', detune: -12, octave: 2 + 4 / 12, gain: 0.2 },
    ],
    filter: { type: 'lowpass', cutoff: 3000, q: 1.2, envAmount: 1.2, envDecay: 0.1, keyTrack: 0.5, velTrack: 0.6 },
    body: { freq: 1100, gain: 5, q: 2 },
    amp: { attack: 0.002, decay: 3, sustain: 0.05, release: 2.4 },
    noise: 0.15, noiseDecay: 0.01, noiseFreq: 2600,
    humanize: 0.12, width: 0.5, send: { reverb: 0.6 }, volume: 0.58,
  }),
  P('wld-sarangi', 'Sarangi', 'World', {
    layers: [
      { wave: 'sawtooth', detune: 0, octave: 0, gain: 1 },
      { wave: 'sawtooth', detune: 9, octave: 1, gain: 0.15 },  // sympathetic strings
    ],
    filter: { type: 'bandpass', cutoff: 1500, q: 2.4, envAmount: 1.4, envDecay: 0.5, keyTrack: 0.55, velTrack: 0.7 },
    body: { freq: 2400, gain: 9, q: 2.6 },
    amp: { attack: 0.1, decay: 0.5, sustain: 0.85, release: 0.6 },
    glide: 0.1, vibrato: { rate: 5.8, depth: 20 },
    humanize: 0.3, width: 0.3, send: { reverb: 0.55 }, volume: 0.56,
  }),
  P('wld-dizi', 'Dizi', 'World', {
    layers: [
      { wave: 'sine', detune: 0, octave: 1, gain: 1 },
      { wave: 'sawtooth', detune: 4, octave: 1, gain: 0.08 },  // the membrane buzz
    ],
    filter: { type: 'lowpass', cutoff: 4800, q: 1.4, envAmount: 0.8, envDecay: 0.2, keyTrack: 0.5, velTrack: 0.6 },
    body: { freq: 3600, gain: 6, q: 3 },
    amp: { attack: 0.04, decay: 0.25, sustain: 0.85, release: 0.2 },
    noise: 0.3, noiseDecay: 0.1, noiseFreq: 6000,
    glide: 0.04, vibrato: { rate: 5.8, depth: 12 },
    humanize: 0.25, send: { reverb: 0.45 }, volume: 0.55,
  }),
  P('wld-charango', 'Charango', 'World', {
    layers: [
      { wave: 'triangle', detune: -7, octave: 1, gain: 0.8 },
      { wave: 'sawtooth', detune: 7, octave: 1, gain: 0.3 },
      { wave: 'triangle', detune: 0, octave: 0, gain: 0.4 },
    ],
    filter: { type: 'lowpass', cutoff: 4400, q: 1.4, envAmount: 2, envDecay: 0.08, keyTrack: 0.6, velTrack: 0.85 },
    body: { freq: 2600, gain: 6, q: 2 },
    amp: { attack: 0.001, decay: 0.7, sustain: 0.04, release: 0.35 },
    noise: 0.25, noiseDecay: 0.01, noiseFreq: 4600,
    humanize: 0.25, width: 0.45, send: { reverb: 0.32 }, volume: 0.6,
  }),

  // ── Vocal ──
  P('voc-boys-choir', 'Boys Choir', 'Vocal', {
    layers: [
      { wave: 'triangle', detune: -7, octave: 0, gain: 0.8 },
      { wave: 'triangle', detune: 7, octave: 0, gain: 0.8 },
      { wave: 'sine', detune: 0, octave: 1, gain: 0.3 },
    ],
    filter: { type: 'bandpass', cutoff: 1300, q: 1.2, envAmount: 0.6, envDecay: 1, keyTrack: 0.6, velTrack: 0.4 },
    body: { freq: 3000, gain: 6, q: 1.8 },
    amp: { attack: 0.3, decay: 0.6, sustain: 0.9, release: 1.1 },
    octave: 1, vibrato: { rate: 5.2, depth: 6 },
    humanize: 0.15, width: 0.7, send: { reverb: 0.75 }, volume: 0.8,
  }),
  P('voc-male-choir', 'Male Choir', 'Vocal', {
    layers: [
      { wave: 'sawtooth', detune: -10, octave: 0, gain: 0.7 },
      { wave: 'sawtooth', detune: 10, octave: 0, gain: 0.7 },
      { wave: 'triangle', detune: 0, octave: -1, gain: 0.4 },
    ],
    filter: { type: 'bandpass', cutoff: 650, q: 1.5, envAmount: 0.6, envDecay: 1, keyTrack: 0.5, velTrack: 0.4 },
    body: { freq: 2400, gain: 7, q: 1.6 },
    amp: { attack: 0.3, decay: 0.7, sustain: 0.9, release: 1 },
    octave: -1, vibrato: { rate: 4.8, depth: 9 },
    humanize: 0.2, width: 0.7, send: { reverb: 0.7 }, volume: 0.58,
  }),
  P('voc-soprano', 'Soprano', 'Vocal', {
    layers: [
      { wave: 'triangle', detune: 0, octave: 0, gain: 1 },
      { wave: 'sawtooth', detune: 2, octave: 0, gain: 0.2 },
    ],
    filter: { type: 'lowpass', cutoff: 2400, q: 1.2, envAmount: 0.8, envDecay: 0.6, keyTrack: 0.6, velTrack: 0.6 },
    body: { freq: 3100, gain: 9, q: 2.2 },   // the singer's formant
    amp: { attack: 0.12, decay: 0.4, sustain: 0.9, release: 0.6 },
    octave: 1, glide: 0.05, vibrato: { rate: 5.6, depth: 24 },
    humanize: 0.2, send: { reverb: 0.6 }, volume: 0.9,
  }),
  P('voc-breath', 'Breath Choir', 'Vocal', {
    layers: [
      { wave: 'sine', detune: -6, octave: 0, gain: 0.8 },
      { wave: 'sine', detune: 6, octave: 0, gain: 0.8 },
      { wave: 'triangle', detune: 0, octave: 1, gain: 0.2 },
    ],
    filter: { type: 'lowpass', cutoff: 1800, q: 0.9, envAmount: 0.6, envDecay: 1.4, keyTrack: 0.5, velTrack: 0.3 },
    amp: { attack: 0.5, decay: 0.8, sustain: 0.85, release: 1.6 },
    noise: 0.5, noiseDecay: 1.2, noiseFreq: 3200,
    vibrato: { rate: 4.4, depth: 5 },
    humanize: 0.18, width: 0.8, send: { reverb: 0.8, chorus: 0.25 }, volume: 0.55,
  }),
  P('voc-doo', 'Doo Choir', 'Vocal', {
    layers: [
      { wave: 'triangle', detune: -5, octave: 0, gain: 0.9 },
      { wave: 'triangle', detune: 5, octave: 0, gain: 0.9 },
    ],
    filter: { type: 'lowpass', cutoff: 900, q: 2, envAmount: 1.6, envDecay: 0.12, keyTrack: 0.5, velTrack: 0.6 },
    body: { freq: 500, gain: 6, q: 1.6 },
    amp: { attack: 0.02, decay: 0.3, sustain: 0.5, release: 0.25 },
    vibrato: { rate: 5, depth: 6 },
    humanize: 0.2, width: 0.6, send: { reverb: 0.45 }, volume: 0.66,
  }),

  // ── Organ & keys ──
  P('organ-theatre', 'Theatre Organ', 'Organ', {
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'sine', detune: 0, octave: 1, gain: 0.6 },
      { wave: 'triangle', detune: 0, octave: -1, gain: 0.5 },
      { wave: 'sine', detune: 0, octave: 2, gain: 0.25 },
    ],
    filter: { type: 'lowpass', cutoff: 4000, q: 0.8, envAmount: 0, envDecay: 0.3, keyTrack: 0.3, velTrack: 0 },
    amp: { attack: 0.02, decay: 0.2, sustain: 1, release: 0.25 },
    vibrato: { rate: 6.8, depth: 14 },   // the tremulant
    width: 0.4, send: { reverb: 0.45, chorus: 0.3 }, volume: 0.5,
  }),
  P('organ-gospel', 'Gospel Organ', 'Organ', {
    layers: [
      { wave: 'sine', detune: 0, octave: -1, gain: 0.8 },
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'sine', detune: 2, octave: 7 / 12 + 1, gain: 0.45 },
      { wave: 'square', detune: 0, octave: 2, gain: 0.08 },
    ],
    filter: { type: 'lowpass', cutoff: 5200, q: 0.8, envAmount: 0.6, envDecay: 0.05, keyTrack: 0.3, velTrack: 0.2 },
    amp: { attack: 0.004, decay: 0.15, sustain: 0.95, release: 0.08 },
    noise: 0.12, noiseDecay: 0.01, noiseFreq: 3000,   // key click
    drive: 0.25, width: 0.35, send: { reverb: 0.25, chorus: 0.5 }, volume: 0.5,
  }),
  P('organ-calliope', 'Calliope', 'Organ', {
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'triangle', detune: 8, octave: 1, gain: 0.3 },
    ],
    filter: { type: 'lowpass', cutoff: 3200, q: 1, envAmount: 0.6, envDecay: 0.1, keyTrack: 0.4, velTrack: 0.3 },
    amp: { attack: 0.03, decay: 0.2, sustain: 0.9, release: 0.1 },
    noise: 0.35, noiseDecay: 0.2, noiseFreq: 4400,   // steam
    vibrato: { rate: 7, depth: 9 },
    humanize: 0.25, send: { reverb: 0.3 }, volume: 0.55,
  }),
  P('keys-harmonium', 'Harmonium', 'Keys', {
    layers: [
      { wave: 'sawtooth', detune: -4, octave: 0, gain: 0.6 },
      { wave: 'square', detune: 4, octave: 0, gain: 0.4 },
      { wave: 'sawtooth', detune: 0, octave: -1, gain: 0.3 },
    ],
    filter: { type: 'lowpass', cutoff: 1600, q: 1.2, envAmount: 0.6, envDecay: 0.3, keyTrack: 0.4, velTrack: 0.4 },
    body: { freq: 1100, gain: 5, q: 1.4 },
    amp: { attack: 0.08, decay: 0.3, sustain: 0.9, release: 0.2 },
    noise: 0.1, noiseDecay: 0.1, noiseFreq: 2000,
    humanize: 0.15, width: 0.3, send: { reverb: 0.35 }, volume: 0.55,
  }),
  P('keys-tape-flute', 'Tape Flute', 'Keys', {
    layers: [
      { wave: 'sine', detune: 0, octave: 0, gain: 1 },
      { wave: 'triangle', detune: 6, octave: 1, gain: 0.18 },
    ],
    filter: { type: 'lowpass', cutoff: 2600, q: 0.8, envAmount: 0.4, envDecay: 0.3, keyTrack: 0.5, velTrack: 0.3 },
    amp: { attack: 0.08, decay: 0.4, sustain: 0.85, release: 0.3 },
    noise: 0.2, noiseDecay: 0.25, noiseFreq: 4000,
    vibrato: { rate: 0.7, depth: 9 },   // the tape's wow
    humanize: 0.2, width: 0.3, send: { reverb: 0.4, chorus: 0.2 }, volume: 0.62,
  }),
  P('keys-tape-choir', 'Tape Choir', 'Keys', {
    layers: [
      { wave: 'sawtooth', detune: -7, octave: 0, gain: 0.6 },
      { wave: 'triangle', detune: 7, octave: 0, gain: 0.8 },
    ],
    filter: { type: 'bandpass', cutoff: 1000, q: 0.9, envAmount: 0.6, envDecay: 0.8, keyTrack: 0.5, velTrack: 0.3 },
    body: { freq: 2600, gain: 6, q: 1.6 },
    amp: { attack: 0.15, decay: 0.6, sustain: 0.85, release: 0.6 },
    vibrato: { rate: 0.6, depth: 11 },
    humanize: 0.2, width: 0.6, send: { reverb: 0.55, chorus: 0.3 }, volume: 0.8,
  }),

  // ── Synth textures ──
  P('lead-theremin', 'Theremin', 'Synth Lead', {
    layers: [{ wave: 'sine', detune: 0, octave: 0, gain: 1 }, { wave: 'triangle', detune: 0, octave: 1, gain: 0.1 }],
    filter: { type: 'lowpass', cutoff: 5000, q: 0.7, envAmount: 0, envDecay: 0.3, keyTrack: 0.3, velTrack: 0.2 },
    amp: { attack: 0.08, decay: 0.3, sustain: 0.92, release: 0.4 },
    glide: 0.18, vibrato: { rate: 6, depth: 26 },
    send: { reverb: 0.5, delay: 0.2 }, volume: 0.6,
  }),
  P('lead-whistle', 'Synth Whistle', 'Synth Lead', {
    layers: [{ wave: 'sine', detune: 0, octave: 1, gain: 1 }],
    filter: { type: 'lowpass', cutoff: 7000, q: 0.7, envAmount: 0, envDecay: 0.3, keyTrack: 0.3, velTrack: 0.2 },
    amp: { attack: 0.02, decay: 0.2, sustain: 0.9, release: 0.15 },
    noise: 0.15, noiseDecay: 0.06, noiseFreq: 7000,
    glide: 0.05, vibrato: { rate: 5.5, depth: 12 },
    send: { reverb: 0.35, delay: 0.25 }, volume: 0.5,
  }),
  P('pad-shimmer', 'Shimmer Pad', 'Synth Pad', {
    layers: [
      { wave: 'sawtooth', detune: -10, octave: 0, gain: 0.5 },
      { wave: 'sawtooth', detune: 10, octave: 0, gain: 0.5 },
      { wave: 'sine', detune: 4, octave: 1, gain: 0.5 },
      { wave: 'sine', detune: -4, octave: 2, gain: 0.25 },
    ],
    filter: { type: 'lowpass', cutoff: 3200, q: 0.9, envAmount: 1, envDecay: 2, keyTrack: 0.3, velTrack: 0.3 },
    amp: { attack: 1.1, decay: 1.5, sustain: 0.85, release: 2.4 },
    width: 0.85, send: { reverb: 0.8, delay: 0.2, chorus: 0.3 }, volume: 0.45,
  }),
  P('pad-frozen', 'Frozen Lake', 'Synth Pad', {
    layers: [
      { wave: 'triangle', detune: -14, octave: 0, gain: 0.7 },
      { wave: 'triangle', detune: 14, octave: 0, gain: 0.7 },
      { wave: 'sine', detune: 0, octave: 19 / 12, gain: 0.25 },
    ],
    filter: { type: 'lowpass', cutoff: 2200, q: 2.2, envAmount: 1.6, envDecay: 3, keyTrack: 0.3, velTrack: 0.3 },
    amp: { attack: 1.5, decay: 2, sustain: 0.8, release: 3 },
    vibrato: { rate: 0.3, depth: 8 },
    width: 0.9, send: { reverb: 0.85, chorus: 0.25 }, volume: 0.5,
  }),
  P('pluck-raindrop', 'Raindrop', 'Synth Pluck', {
    layers: [
      { wave: 'sine', detune: 0, octave: 1, gain: 1 },
      { wave: 'triangle', detune: 7, octave: 2, gain: 0.2 },
    ],
    filter: { type: 'lowpass', cutoff: 5000, q: 1.6, envAmount: 2, envDecay: 0.05, keyTrack: 0.6, velTrack: 0.7 },
    amp: { attack: 0.001, decay: 0.45, sustain: 0, release: 0.4 },
    glide: 0.01, humanize: 0.12, width: 0.4, send: { reverb: 0.55, delay: 0.45 }, volume: 0.6,
  }),

  // ── FX ──
  P('fx-wind', 'Howling Wind', 'FX', {
    // Detuned saws through a narrow, slowly wandering band: the whistle of wind
    layers: [
      { wave: 'sawtooth', detune: -40, octave: 0, gain: 0.7 },
      { wave: 'sawtooth', detune: 35, octave: 0, gain: 0.7 },
      { wave: 'sawtooth', detune: 7, octave: 1 + 1 / 12, gain: 0.4 },
    ],
    filter: { type: 'bandpass', cutoff: 900, q: 7, envAmount: 1.4, envDecay: 3, keyTrack: 0.6, velTrack: 0.5 },
    amp: { attack: 0.9, decay: 1.5, sustain: 0.75, release: 2 },
    noise: 0.8, noiseDecay: 1.5, noiseFreq: 1200,
    glide: 0.4, vibrato: { rate: 0.4, depth: 60 },
    width: 0.8, send: { reverb: 0.7 }, volume: 0.95,
  }),
  P('fx-ufo', 'UFO', 'FX', {
    layers: [
      { wave: 'sine', detune: 0, octave: 1, gain: 1 },
      { wave: 'sine', detune: 40, octave: 1, gain: 0.7 },
    ],
    filter: { type: 'lowpass', cutoff: 4000, q: 4, envAmount: 0, envDecay: 0.3, keyTrack: 0.3, velTrack: 0.3 },
    amp: { attack: 0.3, decay: 1, sustain: 0.8, release: 1.5 },
    glide: 0.35, vibrato: { rate: 9, depth: 120 },
    width: 0.6, send: { reverb: 0.6, delay: 0.4 }, volume: 0.45,
  }),
  P('fx-reverse-swell', 'Reverse Swell', 'FX', {
    layers: [
      { wave: 'sawtooth', detune: -12, octave: 0, gain: 0.6 },
      { wave: 'sawtooth', detune: 12, octave: 0, gain: 0.6 },
      { wave: 'sine', detune: 0, octave: 1, gain: 0.4 },
    ],
    filter: { type: 'lowpass', cutoff: 800, q: 2, envAmount: 4, envDecay: 2.5, keyTrack: 0.3, velTrack: 0.3 },
    amp: { attack: 2.2, decay: 0.1, sustain: 1, release: 0.05 },   // swells, then cuts dead
    width: 0.8, send: { reverb: 0.6 }, volume: 0.45,
  }),
];

export const PRESETS_BY_ID = new Map(INSTRUMENT_PRESETS.map((p) => [p.id, p]));

// ─── Waveshaper curve for drive ───────────────────────────────────────────────

const curveCache = new Map<number, Float32Array<ArrayBuffer>>();

function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const key = Math.round(amount * 20);
  const cached = curveCache.get(key);
  if (cached) return cached;

  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  // k grows sharply with amount so 0→clean, 1→hard clip
  const k = 1 + (key / 20) * 60;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  curveCache.set(key, curve);
  return curve;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

const MAX_VOICES = 64;

/** Per-note routing and automation context supplied by the sequencer. */
export interface NoteContext {
  /** Pan override, used when no channel strip handles it. */
  pan?: number;
  /** Route through this track's channel strip (EQ, fader, sends, sidechain). */
  trackId?: string;
  /** Automation lanes for the track; cutoff/resonance/drive are read from here. */
  lanes?: AutomationLane[];
  /** Song position of the note, needed to look up lane values. */
  startBeat?: number;
  bpm?: number;
  /** The track's own instrument settings, on top of the preset. */
  patch?: InstrumentPatch;
}

export class InstrumentEngine {
  /** Fallback output (no track strip) per audio context — the live one survives exports. */
  private outputs = new WeakMap<BaseAudioContext, GainNode>();
  private overrides = new Map<string, InstrumentOverride>();
  /**
   * Glide memory per track (and preset): the pitch of the last note and the
   * pitch before it. Notes that start together — a chord — all glide from the
   * pitch before the chord instead of from each other.
   */
  private glide = new Map<string, { freq: number; time: number; from: number }>();
  /** Every voice that is sounding or scheduled — lets the transport cut them off. */
  private voices = new VoicePool();
  /** Lifted during offline export, where every note is scheduled ahead of time. */
  private voiceLimit = MAX_VOICES;

  /** Remove the polyphony cap (offline render) and return a function that restores it. */
  unlimitVoices(): () => void {
    const prev = this.voiceLimit;
    const prevGlide = this.glide;
    this.voiceLimit = Number.POSITIVE_INFINITY;
    // An export starts from a clean slate, not from whatever was played live
    this.glide = new Map();
    return () => { this.voiceLimit = prev; this.glide = prevGlide; };
  }

  /** Hard stop: silence every note now, including held and pre-scheduled ones. */
  silenceAll(): void {
    this.voices.silence();
  }

  private atVoiceLimit(ctx: AudioContext): boolean {
    return this.voiceLimit !== Number.POSITIVE_INFINITY && this.voices.count(ctx) >= this.voiceLimit;
  }

  // ─── Configuration ──────────────────────────────────────────────────────────

  setOverride(presetId: string, patch: InstrumentOverride): void {
    this.overrides.set(presetId, { ...this.overrides.get(presetId), ...patch });
  }

  setOverrides(all: Record<string, InstrumentOverride>): void {
    this.overrides = new Map(Object.entries(all));
  }

  /** Preset with the user's overrides folded in. */
  /**
   * Preset with edits folded in: library-wide edits first, then the track's
   * own patch, so a track can sound different from the library default.
   */
  resolve(presetId: string, patch?: InstrumentPatch): InstrumentPreset | null {
    const base = PRESETS_BY_ID.get(presetId);
    if (!base) return null;
    const lib = this.overrides.get(presetId);
    const hasPatch = !!patch && Object.keys(patch).length > 0;
    if (!lib && !hasPatch) return base;
    const o: InstrumentOverride = hasPatch ? { ...lib, ...patch } : lib!;

    const spread = o.detune ?? 0;
    return {
      ...base,
      volume: o.volume ?? base.volume,
      pan: o.pan ?? base.pan,
      octave: o.octave ?? base.octave,
      glide: o.glide ?? base.glide,
      drive: o.drive ?? base.drive,
      width: o.width ?? base.width,
      send: {
        reverb: o.reverbSend ?? base.send.reverb,
        delay: o.delaySend ?? base.send.delay,
        chorus: o.chorusSend ?? base.send.chorus,
      },
      amp: {
        attack: o.attack ?? base.amp.attack,
        decay: o.decay ?? base.amp.decay,
        sustain: o.sustain ?? base.amp.sustain,
        release: o.release ?? base.amp.release,
      },
      filter: {
        ...base.filter,
        cutoff: o.cutoff ?? base.filter.cutoff,
        q: o.resonance ?? base.filter.q,
      },
      layers: spread === 0
        ? base.layers
        : base.layers.map((l, i) => ({
            ...l,
            // Alternate the extra detune around zero so the stack stays centred
            detune: l.detune + (i % 2 === 0 ? spread : -spread) * ((i >> 1) + 1) / base.layers.length,
          })),
    };
  }

  // ─── Playback ───────────────────────────────────────────────────────────────

  private getOutput(ctx: AudioContext): GainNode {
    let out = this.outputs.get(ctx);
    if (!out) {
      out = ctx.createGain();
      const master = getAudioEngine().getMasterGain();
      if (master) out.connect(master);
      this.outputs.set(ctx, out);
    }
    return out;
  }

  /**
   * Schedule one note. `time` and `durationS` are in AudioContext seconds.
   */
  playNote(
    presetId: string,
    midiNote: number,
    velocity: number,
    time: number,
    durationS: number,
    ctxOpts?: NoteContext,
  ): void {
    const ctx = getAudioEngine().getAudioContext();
    if (!ctx) return;
    const preset = this.resolve(presetId, ctxOpts?.patch);
    if (!preset) return;
    if (this.atVoiceLimit(ctx)) this.voices.stealOldest(ctx);

    const opts = ctxOpts ?? {};
    const lanes = opts.lanes;
    const startBeat = opts.startBeat ?? 0;
    const bpm = opts.bpm ?? 120;

    const velNorm = Math.max(0, Math.min(127, velocity)) / 127;

    // Humanize: small random level and tuning variation so repeated notes are
    // never bit-identical, the way a played instrument never is.
    const h = preset.humanize;
    const levelJitter = h > 0 ? 1 + (Math.random() - 0.5) * h * 0.3 : 1;
    const tuneJitter = h > 0 ? (Math.random() - 0.5) * h * 9 : 0;

    const peak = velNorm * preset.volume * levelJitter;
    if (peak < 0.001) return;

    // Voices land on the track's channel strip when the sequencer supplies one,
    // so the fader, EQ, sends and sidechain apply to the whole part at once —
    // including the instrument's own reverb/delay/chorus, which go in through
    // the strip's instrument sends rather than straight to the effects.
    const route = opts.trackId ? getChannelRack().getRoute(opts.trackId) : null;
    const out: AudioNode = route?.input ?? this.getOutput(ctx);

    const freq = midiToFreq(midiNote + preset.octave * 12);
    const { attack, decay, sustain, release } = preset.amp;
    const dur = Math.max(0.02, durationS);

    // ── Chain: layers → [layer panners] → mix → [body] → filter → [drive]
    //           → amp → panner → out (+ FX sends)
    const mix = ctx.createGain();
    mix.gain.value = 1;

    const filter = ctx.createBiquadFilter();
    filter.type = preset.filter.type;
    filter.Q.value = preset.filter.q;

    const amp = ctx.createGain();
    amp.gain.value = 0;

    const panner = ctx.createStereoPanner();
    // When a channel strip handles pan, the voice keeps only the preset's own
    // placement so the two don't fight.
    panner.pan.value = Math.max(-1, Math.min(1, opts.pan ?? preset.pan));

    let head: AudioNode = mix;
    if (preset.body) {
      const body = ctx.createBiquadFilter();
      body.type = 'peaking';
      body.frequency.value = preset.body.freq;
      body.gain.value = preset.body.gain;
      body.Q.value = preset.body.q;
      head.connect(body);
      head = body;
    }
    head.connect(filter);

    // Drive can't be ramped (a WaveShaper curve is fixed once set), so an
    // automated drive lane is sampled at the note's start instead.
    const driveLane = findLane(lanes, 'drive');
    const driveAmount = driveLane ? laneRealAt(driveLane, startBeat) : preset.drive;

    let tail: AudioNode = filter;
    if (driveAmount > 0.01) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = driveCurve(driveAmount);
      shaper.oversample = '2x';
      tail.connect(shaper);
      tail = shaper;
    }
    tail.connect(amp);
    amp.connect(panner);
    panner.connect(out);

    // ── FX sends tap the voice post-pan ──
    // These are the instrument's own character. The track's channel strip adds
    // its own sends downstream, which the mix engineer controls separately.
    const sendNodes = getEffectsBus().connectSends(panner, preset.send, route?.sends);

    // ── Filter: an automation lane replaces the per-note envelope ──
    const noteEnd = Math.max(time + attack + 0.005, time + dur) + release;
    const cutoffLane = findLane(lanes, 'cutoff');
    const resoLane = findLane(lanes, 'resonance');

    if (resoLane) {
      scheduleLaneOnParam(filter.Q, resoLane, time, noteEnd - time, startBeat, bpm);
    }

    if (cutoffLane) {
      // A swept lane under a held chord is the whole reason automation exists —
      // the note keeps moving for its entire length rather than being fixed at
      // whatever the cutoff was when it started.
      scheduleLaneOnParam(filter.frequency, cutoffLane, time, noteEnd - time, startBeat, bpm);
    } else {
      const keyF = preset.filter.cutoff *
        Math.pow(2, preset.filter.keyTrack * (midiNote - 60) / 12);
      // A hard hit is brighter, not just louder — this is most of what makes
      // velocity feel expressive rather than a volume knob.
      const velF = keyF * (1 + preset.filter.velTrack * (velNorm * 2 - 0.7));
      const base = Math.max(40, Math.min(20000, velF));
      if (preset.filter.envAmount > 0.01) {
        const top = Math.max(60, Math.min(20000, base * (1 + preset.filter.envAmount)));
        filter.frequency.setValueAtTime(base, time);
        filter.frequency.linearRampToValueAtTime(top, time + Math.max(0.002, attack));
        filter.frequency.exponentialRampToValueAtTime(
          base, time + attack + Math.max(0.02, preset.filter.envDecay),
        );
      } else {
        filter.frequency.setValueAtTime(base, time);
      }
    }

    // ── Amp envelope ──
    const sustainLevel = Math.max(0.0001, peak * sustain);
    const decayEnd = time + attack + decay;
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.linearRampToValueAtTime(peak, time + attack);
    amp.gain.exponentialRampToValueAtTime(sustainLevel, decayEnd);

    // Note off — hold sustain until the note's end, then release
    const noteOff = Math.max(time + attack + 0.005, time + dur);
    if (noteOff > decayEnd) amp.gain.setValueAtTime(sustainLevel, noteOff);
    const end = noteOff + release;
    amp.gain.exponentialRampToValueAtTime(0.0001, end);

    // ── Vibrato LFO (shared across layers) ──
    let lfo: OscillatorNode | null = null;
    let lfoGain: GainNode | null = null;
    if (preset.vibrato.depth > 0.01 && preset.vibrato.rate > 0.01) {
      lfo = ctx.createOscillator();
      lfoGain = ctx.createGain();
      lfo.type = 'sine';
      lfo.frequency.value = preset.vibrato.rate;
      lfoGain.gain.value = preset.vibrato.depth;
      // Vibrato that starts a touch late reads as played rather than programmed
      lfoGain.gain.setValueAtTime(0, time);
      lfoGain.gain.linearRampToValueAtTime(preset.vibrato.depth, time + Math.min(0.35, dur));
      lfo.connect(lfoGain);
      lfo.start(time);
      lfo.stop(end + 0.02);
    }

    // ── Oscillator layers ──
    const glideKey = `${opts.trackId ?? '~'}:${presetId}`;
    const last = this.glide.get(glideKey);
    const sameChord = !!last && Math.abs(last.time - time) < 0.005;
    const prevFreq = last ? (sameChord ? last.from : last.freq) : undefined;
    const oscs: OscillatorNode[] = [];
    const extras: AudioNode[] = [];
    const layerCount = preset.layers.length;

    for (let i = 0; i < layerCount; i++) {
      const layer = preset.layers[i];
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = layer.wave;
      const layerFreq = freq * Math.pow(2, layer.octave);
      osc.detune.value = layer.detune + tuneJitter;

      if (preset.glide > 0.001 && prevFreq && prevFreq > 0) {
        osc.frequency.setValueAtTime(prevFreq * Math.pow(2, layer.octave), time);
        osc.frequency.exponentialRampToValueAtTime(layerFreq, time + preset.glide);
      } else {
        osc.frequency.setValueAtTime(layerFreq, time);
      }

      lfoGain?.connect(osc.detune);
      g.gain.value = layer.gain;
      osc.connect(g);

      // Stereo width spreads the stack across the field instead of stacking it
      // all dead centre — the difference between "one sound" and "an ensemble".
      if (preset.width > 0.01 && layerCount > 1) {
        const spreadPan = ctx.createStereoPanner();
        const position = layerCount === 1 ? 0 : (i / (layerCount - 1)) * 2 - 1;
        spreadPan.pan.value = position * preset.width;
        g.connect(spreadPan);
        spreadPan.connect(mix);
        extras.push(spreadPan);
      } else {
        g.connect(mix);
      }

      osc.start(time);
      osc.stop(end + 0.02);
      oscs.push(osc);
      extras.push(g);
    }
    this.glide.set(glideKey, { freq, time, from: prevFreq ?? freq });

    // ── Attack transient (pick / breath noise) ──
    if (preset.noise > 0.01) {
      const nStop = time + preset.noiseDecay + 0.01;
      const noise = noiseSource(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = preset.noiseFreq;
      bp.Q.value = 1.2;
      const ng = ctx.createGain();
      // Harder hits bite harder
      ng.gain.setValueAtTime(preset.noise * peak * (0.4 + velNorm * 0.8), time);
      ng.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(0.005, preset.noiseDecay));
      noise.connect(bp); bp.connect(ng); ng.connect(amp);
      startNoise(noise, time, nStop);
      extras.push(bp, ng);
    }

    // ── Cleanup ──
    const voice = this.voices.add(amp, [...oscs, ...(lfo ? [lfo] : [])], time, end + 0.02);
    const first = oscs[0];
    if (first) {
      first.onended = () => {
        this.voices.remove(voice);
        for (const o of oscs) { try { o.disconnect(); } catch (_) { /* ignore */ } }
        for (const n of extras) { try { n.disconnect(); } catch (_) { /* ignore */ } }
        for (const s of sendNodes) { try { s.disconnect(); } catch (_) { /* ignore */ } }
        try { lfo?.disconnect(); lfoGain?.disconnect(); } catch (_) { /* ignore */ }
        try { mix.disconnect(); filter.disconnect(); amp.disconnect(); panner.disconnect(); } catch (_) { /* ignore */ }
      };
    }
  }

  /**
   * One note from an oscillator-lab tab used as a track's sound source.
   *
   * A fresh oscillator per note makes it polyphonic — chords and overlapping
   * notes all sound — and the lab's waveform, pulse width and detune carry
   * over. A low-pass sits after it so cutoff and resonance automation work on
   * oscillator tracks too.
   */
  playOscillatorNote(
    oscState: OscillatorState,
    advanced: AdvancedSettings,
    midiNote: number,
    velocity: number,
    time: number,
    durationS: number,
    ctxOpts: NoteContext = {},
  ): void {
    const ctx = getAudioEngine().getAudioContext();
    if (!ctx) return;
    if (this.atVoiceLimit(ctx)) this.voices.stealOldest(ctx);

    // Headroom: unlike the single lab voice, several of these stack up
    const peak = (Math.max(0, Math.min(127, velocity)) / 127) * oscState.amplitude * 0.5;
    if (peak < 0.001) return;

    const route = ctxOpts.trackId ? getChannelRack().getRoute(ctxOpts.trackId) : null;
    const out: AudioNode = route?.input ?? this.getOutput(ctx);
    const startBeat = ctxOpts.startBeat ?? 0;
    const bpm = ctxOpts.bpm ?? 120;

    const osc = ctx.createOscillator();
    applyWaveformToNode(ctx, osc, oscState);
    osc.frequency.setValueAtTime(midiToFreq(midiNote), time);
    osc.detune.value = advanced.centsOffset;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.value = 20000;

    const amp = ctx.createGain();
    const attack = 0.005;
    const release = 0.04;
    const noteOff = Math.max(time + attack + 0.005, time + Math.max(0.02, durationS));
    const end = noteOff + release;
    amp.gain.setValueAtTime(0, time);
    amp.gain.linearRampToValueAtTime(peak, time + attack);
    amp.gain.setValueAtTime(peak, noteOff);
    amp.gain.linearRampToValueAtTime(0, end);

    const cutoffLane = findLane(ctxOpts.lanes, 'cutoff');
    const resoLane = findLane(ctxOpts.lanes, 'resonance');
    if (cutoffLane) scheduleLaneOnParam(filter.frequency, cutoffLane, time, end - time, startBeat, bpm);
    if (resoLane) scheduleLaneOnParam(filter.Q, resoLane, time, end - time, startBeat, bpm);

    osc.connect(filter);
    filter.connect(amp);
    amp.connect(out);
    osc.start(time);
    osc.stop(end + 0.02);

    const voice = this.voices.add(amp, [osc], time, end + 0.02);
    osc.onended = () => {
      this.voices.remove(voice);
      try { osc.disconnect(); filter.disconnect(); amp.disconnect(); } catch { /* ignore */ }
    };
  }

  /** Audition a preset — plays a short phrase suited to its category. */
  async preview(presetId: string, patch?: InstrumentPatch): Promise<void> {
    const preset = this.resolve(presetId, patch);
    if (!preset) return;
    const ctx = await getAudioEngine().getOrCreateAudioContext();
    const t = ctx.currentTime + 0.05;

    const phrase = PREVIEW_PHRASES[preset.category];
    for (const { note, at, dur, vel } of phrase) {
      this.playNote(presetId, note, vel, t + at, dur, { patch });
    }
  }
}

// ─── Audition phrases per category ────────────────────────────────────────────

interface PreviewNote { note: number; at: number; dur: number; vel: number }

const CHORD = (root: number, offs: number[], at: number, dur: number, vel: number, strum = 0): PreviewNote[] =>
  offs.map((o, i) => ({ note: root + o, at: at + i * strum, dur, vel }));

const RIFF: PreviewNote[] = [
  { note: 72, at: 0, dur: 0.22, vel: 100 },
  { note: 74, at: 0.22, dur: 0.22, vel: 95 },
  { note: 76, at: 0.44, dur: 0.22, vel: 100 },
  { note: 79, at: 0.66, dur: 0.7, vel: 110 },
];

const BASS_LINE: PreviewNote[] = [
  { note: 48, at: 0, dur: 0.28, vel: 110 },
  { note: 48, at: 0.35, dur: 0.2, vel: 78 },
  { note: 55, at: 0.6, dur: 0.28, vel: 105 },
  { note: 46, at: 0.95, dur: 0.5, vel: 115 },
];

const ARPEGGIO: PreviewNote[] = [
  { note: 67, at: 0, dur: 0.9, vel: 100 },
  { note: 71, at: 0.14, dur: 0.9, vel: 88 },
  { note: 74, at: 0.28, dur: 1.2, vel: 105 },
  { note: 79, at: 0.42, dur: 1.4, vel: 95 },
];

const PREVIEW_PHRASES: Record<InstrumentCategory, PreviewNote[]> = {
  // Piano and keys get a voiced chord with a little roll, plus a top note
  'Piano': [
    ...CHORD(48, [0, 7], 0, 2.2, 72, 0.015),
    ...CHORD(64, [0, 5, 9], 0.06, 2, 96, 0.02),
  ],
  'Keys': CHORD(60, [0, 4, 7, 11], 0, 1.6, 95, 0.02),
  'Organ': CHORD(55, [0, 7, 12, 16], 0, 1.8, 90),
  'Synth Lead': RIFF,
  'Synth Pad': CHORD(60, [0, 4, 7, 12], 0, 2.6, 85),
  'Synth Bass': BASS_LINE,
  'Synth Pluck': [
    { note: 72, at: 0, dur: 0.3, vel: 105 },
    { note: 76, at: 0.16, dur: 0.3, vel: 95 },
    { note: 79, at: 0.32, dur: 0.3, vel: 100 },
    { note: 84, at: 0.48, dur: 0.8, vel: 110 },
  ],
  'Electric Guitar': CHORD(52, [0, 7, 12, 16], 0, 1.6, 105, 0.028),
  'Acoustic Guitar': CHORD(52, [0, 7, 12, 16, 19], 0, 2, 100, 0.032),
  'Bass Guitar': [
    { note: 40, at: 0, dur: 0.4, vel: 112 },
    { note: 47, at: 0.45, dur: 0.3, vel: 88 },
    { note: 52, at: 0.8, dur: 0.6, vel: 108 },
  ],
  'Strings': CHORD(57, [0, 4, 7, 12], 0, 2, 95, 0.01),
  'Brass': [
    { note: 60, at: 0, dur: 0.35, vel: 105 },
    { note: 64, at: 0.35, dur: 0.35, vel: 100 },
    ...CHORD(55, [0, 7, 12], 0.72, 1.2, 112, 0.008),
  ],
  'Woodwind': [
    { note: 72, at: 0, dur: 0.35, vel: 90 },
    { note: 74, at: 0.34, dur: 0.3, vel: 96 },
    { note: 77, at: 0.62, dur: 0.3, vel: 102 },
    { note: 79, at: 0.9, dur: 1, vel: 96 },
  ],
  'Mallets': ARPEGGIO,
  'Plucked': ARPEGGIO,
  'Vocal': CHORD(57, [0, 4, 7, 12], 0, 2.4, 92, 0.02),
  'World': [
    { note: 62, at: 0, dur: 0.5, vel: 100 },
    { note: 65, at: 0.4, dur: 0.4, vel: 92 },
    { note: 69, at: 0.75, dur: 1.2, vel: 106 },
  ],
  'FX': [{ note: 60, at: 0, dur: 1.8, vel: 100 }],
};

// ─── Singleton ────────────────────────────────────────────────────────────────

let _engine: InstrumentEngine | null = null;

export function getInstrumentEngine(): InstrumentEngine {
  if (!_engine) _engine = new InstrumentEngine();
  return _engine;
}
