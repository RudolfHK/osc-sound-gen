# OSC — Digital Oscillator Synthesizer

A browser-based (and optionally desktop) digital oscilloscope and multi-track synthesizer. Set oscillator parameters, compose note sequences in a piano roll, mix tracks, and record the output — all rendered in real time at 60 fps.

---

## Quick Start (Web)

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. Click **▶ PLAY** on any oscillator tab to activate audio (required once by browser autoplay policy).

```bash
npm run build    # Production bundle → dist/
npm run preview  # Serve the production build locally
npm run lint     # TypeScript type-check (no emit)
```

For a detailed setup walkthrough see [QUICKSTART.md](QUICKSTART.md). For full feature documentation see [GUIDE.md](GUIDE.md).

---

## Quick Start (Desktop — Electron)

The repo ships with an Electron main process at `electron/main.cjs`. To run the app as a native desktop window:

### 1. Install Electron (one-time)

```bash
npm install --save-dev electron electron-builder
```

### 2. Run in dev mode (hot-reload)

Open two terminals:

```bash
# Terminal 1 — start Vite dev server
npm run dev

# Terminal 2 — launch Electron (connects to http://localhost:5173)
npm run electron:dev
```

### 3. Build a distributable installer

```bash
npm run electron:build
```

Output is placed in `release/`:

| Platform | File |
|----------|------|
| Windows  | `OSC Synthesizer Setup 1.0.0.exe` (NSIS installer, ~150 MB) |
| macOS    | `OSC Synthesizer-1.0.0.dmg` |
| Linux    | `OSC Synthesizer-1.0.0.AppImage` |

> **Icon files**: electron-builder needs `assets/icon.ico` (Windows), `assets/icon.icns` (macOS), `assets/icon.png` (Linux) before building. See [assets/ICONS.md](assets/ICONS.md) for conversion instructions.

For the complete Electron packaging guide including code signing and auto-updater, see [SHIPPING_PLAN.md](SHIPPING_PLAN.md).

---

## Features

### Oscillator engine
- **4 waveforms**: Sine, Square (variable pulse width via Fourier series), Sawtooth, Triangle
- **Logarithmic frequency slider**: 20 Hz – 20 kHz with precision type-in input
- **Smooth parameter transitions**: `setTargetAtTime` with 10 ms time constant — no clicks or zipper noise
- **Multi-oscillator**: unlimited tabs, each independent Play/Stop, Mute/Solo, rename, drag-reorder

### Oscilloscope
- 60 fps Canvas 2D rendering, 2048-sample buffer, antialiased phosphor-glow line
- **Single mode**: active oscillator with amplitude grid and timing ruler
- **Overlay mode**: all oscillators rendered simultaneously with a white SUM waveform

### Sequencer / Piano Roll
- Piano roll editor with **Draw** and **Select** edit modes
- **Configurable note length** — set default duration before drawing
- **Velocity lane** — toggle a 50 px lane below the roll; drag bars to set per-note velocity
- **Loop region** — colored overlay; sequencer loops the marked region
- **Snap grid**: 1/1 → 1/32 note resolution; Shift+drag for free movement
- **Undo/Redo** — 50 levels; Ctrl+Z / Ctrl+Shift+Z (⌘ on Mac)
- **Copy/Paste** — Ctrl+C copies selected notes; Ctrl+V pastes at playhead position
- **Select-all / deselect** — Ctrl+A / Escape
- **Quantize** — Q key or Q button snaps selected notes to snap grid
- **Computer keyboard piano** — A/W/S/E/D/F/T/G/Y/H/U/J/K preview notes in the tab's waveform

### Mixer
- Per-track VU meters (activate once any oscillator starts playing)
- Volume fader and stereo pan per track
- Master volume strip
- Mute/Solo per track

### Drum Machine (`DRUMS`)
- **33 synthesized voices** — three kick variants (acoustic, 808, tight), three snares
  (acoustic, 808, brush), closed/open/pedal hi-hats, clap, rim, snap, three toms,
  crash, splash, ride, ride bell, reverse cymbal, cowbell, shaker, cabasa, tambourine,
  congas, bongo, timbale, woodblock, clave, triangle, and two FX voices
- All voices are synthesized at runtime via the Web Audio API — no sample files to download
- **34 genre patterns** — Rock, Punk, Metal, Ballad, Shuffle, Hip-Hop, Boom Bap, Lo-Fi,
  Trap, House, Deep House, Techno, Electro, Synthwave, Dubstep, UK Garage, Drum & Bass,
  Amen Break, Breakbeat, Funk, Motown, Disco, Jazz, Bossa Nova, Salsa, Samba, Reggaeton,
  Cumbia, Afrobeat, Marching, and more
- 16- or 32-step grid, per-pattern swing, group filtering (KIT / CYMBAL / PERC / FX)
- **Right-click a step** → velocity, pitch, decay for that single hit
- **Right-click a voice name** → volume, pan, tone, pitch, decay for the whole row
- Per-voice mute/solo; BPM syncs to the sequencer

### Instrument Library (`INSTRUMENTS`)
- **161 subtractive-synthesis presets** across eighteen categories:

  | Group | Categories |
  |-------|-----------|
  | Keyboards | Piano (6), Keys (9), Organ (6) |
  | Synths | Synth Lead (14), Synth Pad (14), Synth Bass (13), Synth Pluck (8) |
  | Guitars | Electric (14), Acoustic (9), Bass Guitar (8) |
  | Orchestral | Strings (9), Brass (8), Woodwind (8) |
  | Tuned percussion | Mallets (7), Plucked (8) |
  | Other | Vocal (5), World (7), FX (8) |

- Acoustic pianos, Rhodes/Wurlitzer, church and drawbar organs; trumpet, trombone, tuba,
  flugelhorn; clarinet, oboe, bassoon, piccolo, pan flute, alto and tenor sax; cello, viola,
  double bass, tremolo and staccato strings; vibraphone, glockenspiel, tubular bells, timpani,
  steel drum; choirs; erhu, oud, shamisen, hang drum, didgeridoo, bagpipe
- Guitars span clean, jazz, jangle, crunch, overdrive, distortion, shoegaze, palm mute, funk
  wah, surf tremolo, slide, e-bow, harmonics and power chord (electric); steel, nylon,
  12-string, folk, bright, picked, parlor, muted and resonator (acoustic)
- Each preset stacks up to five oscillators with independent detune/octave/gain, then runs
  through a body-resonance peaking filter, a filter envelope, an optional waveshaper drive
  stage, an amp ADSR, a stereo-width spread and a panner
- **Velocity shapes brightness, not just level** — hard hits open the filter, so dynamics
  read as playing rather than a volume knob
- **Per-note humanization** applies small random tuning and level variation to acoustic
  presets, so repeated notes are never bit-identical
- Click a card to **audition** it; **right-click** to edit 16 parameters live, grouped into
  Tone / Envelope / Mix
- **Assign a preset to a track** — the sequencer then plays that track's notes through the
  instrument instead of its raw oscillator, so you can layer synths, guitars and drums

### Master Effects (`FX`)
- **Convolution reverb** with a procedurally generated impulse response — adjustable tail
  length (0.2–8 s) and high-frequency damping
- **Ping-pong delay**, tempo-synced to the sequencer (1/4 through 1/16, including dotted and
  triplet) or free-running in milliseconds, with feedback and a damped repeat path
- **Chorus** — two counter-phase modulated delay lines panned hard apart
- **Master limiter** on the output chain, before both the speakers and the recording tap
- Send-based: each preset carries its own reverb/delay/chorus levels, and drums have their
  own sends (kicks and sub drops stay dry to keep the low end tight)

### Recording
- Captures master output to **WebM** (Opus) or **WAV** (16-bit PCM)
- No time limit; WAV conversion handled in-browser via AudioBuffer decoding

### Persistence
- **Auto-save** — full app state (oscillators, sequencer, settings) persists in `localStorage`
- **Project files** — save/load `.oscproject` (JSON) for sharing compositions
- Drum patterns and instrument assignments persist separately in `localStorage`

### Example projects
Six ready-to-load compositions live in [`examples/`](examples/README.md) — four
Minecraft/C418-style pieces, an ambient pad study, and a fast arpeggio demo.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Ctrl+Z** | Undo (piano roll) |
| **Ctrl+Shift+Z** | Redo |
| **Delete / Backspace** | Delete selected notes |
| **Right-click note** | Delete note (Draw mode) |
| **Ctrl+C** | Copy selected notes |
| **Ctrl+V** | Paste notes at playhead |
| **Ctrl+A** | Select all notes in track |
| **Escape** | Deselect all |
| **Q** | Quantize selected notes to snap grid |
| **Shift+click** | Toggle note in/out of selection |
| **A W S E D F T G Y H U J K** | Preview MIDI notes via current oscillator (piano keyboard) |
| **Ctrl+scroll** | Zoom piano roll horizontally |
| **Shift+scroll** | Scroll piano roll vertically (pitch) |
| **Scroll** | Scroll piano roll horizontally (time) |
| **Double-click tab label** | Rename tab |
| **Drag tab** | Reorder tabs |

---

## Oscillator Mathematics

All waveforms are computed analytically — no lookup tables.

```
sine(t)      = A · sin(2π·f·t + φ)
square(t)    = A · (pos(t) < PW ? +1 : −1)   where pos(t) = frac(f·t + φ/2π)
sawtooth(t)  = A · (2 · frac(f·t + φ/2π) − 1)
triangle(t)  = A · (2/π) · arcsin(sin(2π·f·t + φ))
```

The square wave audio engine uses a 256-harmonic Fourier series (`PeriodicWave`) to support variable pulse width while avoiding aliasing artifacts.

---

## Technology

| Layer | Technology |
|-------|-----------|
| UI & state | React 18 + TypeScript, `useReducer` + Context |
| Bundler | Vite 6 |
| Styling | Tailwind CSS 3 (utility-first, dark theme) |
| Audio | Web Audio API — `OscillatorNode`, `GainNode`, `StereoPannerNode`, `AnalyserNode`, `MediaRecorder` |
| Oscilloscope | Canvas 2D API, 60 fps `requestAnimationFrame` loop |
| Piano roll | Canvas 2D API, lookahead scheduler (120 ms / 25 ms interval) |
| Desktop | Electron (optional, see above) |

---

## Architecture

```
src/
├── engine/
│   ├── oscillator.ts      state types and defaults
│   ├── audio.ts           Web Audio API engine (singleton MultiOscillatorEngine)
│   └── sequencer.ts       lookahead scheduler + per-track audio nodes
├── sequencer/
│   ├── PianoRoll.tsx      canvas piano roll, all note interaction
│   ├── SequencerPanel.tsx panel layout, project save/load, resize handle
│   ├── TransportBar.tsx   BPM, loop, snap, NOTE, VEL, Q, undo/redo
│   ├── TrackHeader.tsx    per-track sidebar (mute/solo/pan)
│   └── Mixer.tsx          per-track VU meters + faders
├── store/
│   └── appStore.ts        useReducer + Context, localStorage persistence
├── ui/
│   ├── controls.tsx       oscillator parameter controls
│   ├── layout.tsx         top-level layout, oscilloscope bridge
│   ├── TabBar.tsx         tab add/remove/rename/reorder
│   └── RecordingControls.tsx recording bar
├── visualizer/
│   └── oscilloscope.ts    canvas renderer, single + overlay modes
├── utils/
│   ├── math.ts            waveform math, log↔freq mapping, Fourier coefficients
│   ├── music.ts           MIDI utils, snap grid, sequencer types
│   ├── colors.ts          tab color palette
│   └── wav.ts             WAV encoding utilities
└── main.tsx               React entry point
electron/
└── main.cjs               Electron main process (CommonJS)
assets/
└── ICONS.md               Icon conversion instructions for electron-builder
```

---

## Free and Open Source

All dependencies are MIT, Apache-2.0, BSD-3-Clause, ISC, or CC-BY-4.0. No proprietary SDKs, analytics, or external API calls.

```bash
npm run audit:licenses   # verify the full dependency tree
```

See [LICENSES.md](LICENSES.md) for the complete inventory.
