# OSC — Digital Oscillator Synthesizer

A browser-based digital oscilloscope and synthesizer. Set oscillator parameters, see the waveform update live at 60 fps, and hear the corresponding audio — all in sync.

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. Click **▶ PLAY** to start audio (required by browser autoplay policy — audio context activates on first user gesture).

### Other commands

```bash
npm run build    # Production build → dist/
npm run preview  # Serve the production build locally
npm run lint     # Type-check only (no emit)
```

## Features

- **4 waveforms**: Sine, Square (with variable pulse width), Sawtooth, Triangle
- **Real-time oscilloscope**: 60 fps canvas rendering, 2048-sample buffer, antialiased phosphor-glow waveform
- **Live audio**: Web Audio API with smooth parameter transitions (no clicks on frequency/amplitude changes)
- **Logarithmic frequency slider**: 20 Hz – 20 kHz with type-in numeric input
- **Advanced panel**: detune (cents), zoom (cycles shown), line thickness, colour theme, grid toggle

## Controls

| Control | Range | Notes |
|---------|-------|-------|
| Waveform | Sine / Square / Saw / Triangle | Segmented selector |
| Frequency | 20 – 20 000 Hz | Log scale slider; click value to type exact Hz |
| Amplitude | 0.0 – 1.0 | Maps to waveform height and audio level |
| Phase | 0° – 360° | Phase offset in radians |
| Pulse Width | 1% – 99% | Square wave only |
| Master Volume | 0% – 100% | Independent of amplitude |

## Oscillator Mathematics

All waveforms are computed analytically from first principles — no lookup tables.

```
sine(t)      = A · sin(2π·f·t + φ)

square(t)    = A · (pos(t) < PW ? +1 : −1)
               where pos(t) = frac(f·t + φ/2π)

sawtooth(t)  = A · (2 · frac(f·t + φ/2π) − 1)

triangle(t)  = A · (2/π) · arcsin(sin(2π·f·t + φ))
```

Where `t` = time in seconds, `f` = frequency in Hz, `φ` = phase offset in radians, `A` = amplitude, `PW` = pulse width, `frac()` = fractional part.

### Square Wave with Variable Pulse Width (Audio)

The Web Audio API's native `OscillatorNode` is fixed at 50% duty cycle. To support arbitrary pulse widths, the audio engine computes a `PeriodicWave` from the Fourier series of a rectangular pulse:

```
DC:         real[0] = 2D − 1
Cosine[n]:  real[n] = 2·sin(2πnD) / (πn)
Sine[n]:    imag[n] = 2·(1 − cos(2πnD)) / (πn)
```

where `D` is the duty cycle (pulse width). 256 harmonics are used, giving excellent fidelity. The wave is updated via `OscillatorNode.setPeriodicWave()` whenever pulse width changes.

### Smooth Parameter Transitions

All audio parameter changes use `AudioParam.setTargetAtTime(newValue, ctx.currentTime, 0.01)` instead of direct assignment, giving a 10 ms exponential approach that eliminates clicks and zipper noise when sweeping frequency or amplitude.

## Technology

- **React 18** + **TypeScript** — UI and state management  
- **Vite** — dev server and production bundler  
- **Web Audio API** — oscillator engine, GainNodes, PeriodicWave  
- **Canvas 2D API** — 60 fps oscilloscope rendering  
- **Tailwind CSS** — utility-first dark-theme styling

## Architecture

```
src/
├── engine/
│   ├── oscillator.ts   state types and defaults
│   └── audio.ts        Web Audio API engine (singleton)
├── visualizer/
│   └── oscilloscope.ts canvas renderer, 60 fps RAF loop
├── ui/
│   ├── controls.tsx    all parameter controls
│   └── layout.tsx      top-level layout + ResizeObserver
├── utils/
│   └── math.ts         waveform math, log↔freq mapping, Fourier coefficients
└── main.tsx            React entry point
```
