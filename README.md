# OSC — Digital Oscillator Synthesizer

A browser-based (and optionally desktop) music production app: an arrangement of tracks, clips and song sections; a piano roll and drum step sequencer; 161 synthesized instruments; a mixer with per-track EQ, sends and sidechain; master effects; automation; and an optional oscillator lab with a live oscilloscope. Everything is synthesized in real time by the Web Audio API — no sample files.

---

## Quick Start (Web)

```bash
npm install
npm run dev
```

Open **http://localhost:5173** and press **Space** (or **▶ PLAY**) — the browser needs one click or key press before it allows audio. To hear what it can do straight away, open **OSC ▾ → Open example → midnight drive**.

```bash
npm run build      # Type-check app + tests, then production bundle → dist/
npm run preview    # Serve the production build locally
npm run lint       # Type-check only
npm test           # Unit tests (Vitest)
npm run test:e2e   # Browser tests against dist/ (run `npm run build` first)
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

### Arrangement
- **Tracks own their sound** — an instrument preset, a drum kit, or (optionally) an oscillator from the lab
- **Clips** on a timeline, each playing a looping **pattern**: drag to move (across tracks too), Alt-drag to copy,
  drag either edge to loop or trim, Ctrl+D to duplicate, Ctrl+E to split, per-clip mute
- **Linked or independent copies** — duplicates are independent by default, as in Ableton and Logic; linked
  clips share a pattern and show ⧉
- **Song sections** on the ruler (Intro, Verse, Drop…): duplicate a section with everything in it, delete one and
  close the gap, or loop it with one click
- Bar ruler: click to seek, drag to set the loop; a loop only engages when the playhead reaches it
- Ctrl+wheel zoom around the cursor, Shift+wheel to scroll time, FIT to see the whole song
- Track headers with rename, colour, volume, mute/solo (additive), automation toggle and a ⋯ menu
- Undo/redo covers the whole document — clips, patterns, sections, automation

### Editor dock
- Arrange above, editor below — the Ableton/Logic/Bitwig layout. Tabs for **Editor**, **Mixer**, **Instruments**
  and **FX**; resizable and collapsible
- **Piano roll** for the selected clip: draw/select modes, grid and note length, velocity lane, quantize,
  copy/paste, arrow-key transpose, draggable pattern loop length
- Every note you draw or drag **plays through the track's actual instrument**
- **Drum step sequencer** for drum clips; picking a pattern swaps it into the clip
- Computer-keyboard piano (C4 on A) through the selected track's sound

### Drums
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

### Instrument Library
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

### Master Effects
- **Convolution reverb** with a procedurally generated impulse response — adjustable tail
  length (0.2–8 s) and high-frequency damping
- **Ping-pong delay**, tempo-synced to the sequencer (1/4 through 1/16, including dotted and
  triplet) or free-running in milliseconds, with feedback and a damped repeat path
- **Chorus** — two counter-phase modulated delay lines panned hard apart
- **Master limiter** on the output chain, before both the speakers and the recording tap
- Send-based: each preset carries its own reverb/delay/chorus levels, and drums have their
  own sends (kicks and sub drops stay dry to keep the low end tight)

### Automation
- Per-track breakpoint lanes for **filter cutoff, resonance, drive, volume, pan,
  three EQ bands and three effect sends**
- Cutoff and resonance are written onto the live filter across each note's full
  length, so a held chord keeps moving instead of freezing at its starting value
- Lanes read in looped time, so sweeps repeat with the loop
- An enabled lane takes its parameter over from the mixer (the control dims to say so)
- Lanes sit inline under their track in the arrangement, lined up with its clips

### Arpeggiator
- Per-track, expanding held chords into running patterns at playback
- Rate 1/1–1/32, six modes (`up`, `down`, `updown`, `downup`, `order`, `random`),
  1–4 octave stacking, 5–100% gate
- Overlapping notes are grouped into chords automatically; the piano roll keeps
  showing your long notes, so editing harmony stays a three-note job

### Mixer
- A channel strip per track: 3-band EQ (200 Hz shelf / 1.2 kHz peak / 4 kHz shelf, ±18 dB),
  independent reverb/delay/chorus sends, fader to 150%, pan, mute and solo
- **Real per-track meters** (post-fader peak), plus a master meter
- **Sidechain ducking** — any track can duck under the kicks on a drum track, which is
  what lets kick and bass share a downbeat without masking each other
- Mute acts as a gain, so it silences notes already ringing

### Visualizer (`VIZ`)
- **Off by default and not restored on reload** — it taps the master bus and runs a
  redraw loop, so it only costs CPU while you're watching it
- Four modes: log-spaced spectrum bars, waveform, radial, and concentric bloom
- Customizable sensitivity, smoothing, detail, motion trail, colour mode
  (theme / spectrum / mono), mirror, glow, and a 30/60 FPS cap

### Recording
- **● REC** in the transport records the master output after the limiter; it starts playback if stopped,
  and stopping the transport ends the take
- Download as **WAV** (16-bit PCM) or **WebM** (Opus)

### Oscillator Lab (optional)
- The original synth: **4 waveforms** (square with variable pulse width via a 256-harmonic Fourier series),
  logarithmic 20 Hz – 20 kHz frequency, phase, detune
- 60 fps oscilloscope with single and overlay (with SUM) modes
- Any lab oscillator can be a track's sound — polyphonic, with cutoff/resonance automation

### Persistence
- **Auto-save** — the whole session is kept in `localStorage`, written in debounced batches and never per frame
- **Project files** (`.oscproject`, JSON) are self-contained: tracks, clips, patterns, sections, automation, mixer,
  plus the drum patterns and lab oscillators they use
- Older project files and saved sessions migrate automatically

### Example projects
Seven compositions ship with the app — open them from **OSC ▾ → Open example**, or find the files in
[`examples/`](examples/README.md). They include `midnight-drive`, an original French-touch study that uses
sections, looping clips, the arpeggiator, filter/resonance automation and sidechain together; four
Minecraft/C418-style pieces; an ambient pad study; and a fast arpeggio over techno drums. All are original
compositions.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Space** | Play / stop |
| **Home** | Return to start |
| **Ctrl+Z** / **Ctrl+Shift+Z** | Undo / redo |
| **Ctrl+S** / **Ctrl+O** | Save / open project |
| **Alt+E / X / I / F** | Dock: Editor / Mixer / Instruments / FX |
| **Delete**, **Ctrl+D**, **Ctrl+E** | Delete / duplicate / split the selected clip *(arrangement)* |
| **M** / **S** | Mute / solo the selected track *(arrangement)* |
| **L** / **K** | Loop / metronome *(arrangement)* |
| **A W S E D F T G Y H U J K…** | Play notes *(editor)* |
| **↑ / ↓**, **Q**, **Ctrl+A/C/V** | Transpose, quantize, select/copy/paste notes *(editor)* |

Arrangement and editor shortcuts follow whichever you clicked last; none fire while typing in a text field.
The full list is in [GUIDE.md](GUIDE.md#keyboard-shortcuts).

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
| Arrangement & editors | Canvas 2D; playhead drawn as a transformed overlay, so lanes never redraw during playback |
| Scheduler | Lookahead (120 ms ahead, 25 ms tick) over half-open time windows — each event is scheduled exactly once |
| Tests | Vitest (model, scheduler, migrations, examples) + Playwright (end-to-end, including audio output) |
| Desktop | Electron (optional, see above) |

---

## Architecture

```
src/
├── arrange/
│   ├── ArrangementView.tsx  tracks, clip lanes, inline automation, playhead overlay, clip gestures
│   ├── Ruler.tsx            sections row + bar ruler with loop brace
│   ├── drawLane.ts          clip rendering (note/drum previews, loop markers)
│   └── geometry.ts          beat↔pixel maths, grid
├── engine/
│   ├── timeline.ts          pure event collection over loop-aware windows (unit-tested)
│   ├── sequencer.ts         scheduler: turns timeline events into Web Audio calls
│   ├── playhead.ts          live position outside React state
│   ├── instruments.ts       161 presets, polyphonic preset + oscillator voices
│   ├── sampler.ts           33 synthesized drum voices
│   ├── channelStrip.ts      per-track EQ, fader, pan, sends, mute, sidechain, meters
│   ├── effects.ts           master reverb, delay, chorus
│   ├── automation.ts        lane maths and AudioParam scheduling
│   ├── arpeggiator.ts       chord → arpeggio expansion
│   └── audio.ts             AudioContext, master bus + limiter, lab oscillators
├── sequencer/
│   ├── PianoRoll.tsx        note editor for the selected clip
│   ├── TrackHeader.tsx      editor's pattern column + arpeggiator
│   ├── AutomationLane.tsx   breakpoint editor canvas
│   └── Mixer.tsx            channel strips
├── sampler/                 drum step sequencer, instrument library, FX panel
├── store/
│   ├── appStore.ts          document model reducer, undo, debounced persistence, migration
│   └── …                    drum, instrument, effects and visualizer stores
├── ui/
│   ├── AppShell.tsx         header, view switch, global shortcuts, engine sync
│   ├── Transport.tsx        play/stop/record, position, tempo, loop, metronome
│   ├── Dock.tsx             editor / mixer / instruments / FX tabs
│   ├── OscLab.tsx           optional oscillator lab
│   └── …                    context menus, notices, focus scoping, project actions
├── utils/
│   ├── music.ts             track/clip/pattern/section model, MIDI and beat maths
│   └── project.ts           .oscproject v2 format, v1 + saved-session migration
└── visualizer/              oscilloscope and audio visualizer
e2e/smoke.mjs                browser tests (Playwright)
examples/                    bundled projects
electron/main.cjs            Electron main process
```

---

## Testing

```bash
npm test                          # 41 unit tests: model, reducer, scheduler, migrations, examples
npm run build && npm run test:e2e # 18 browser tests
```

The browser suite drives the built app in Chromium and taps its audio output, so it checks that
playback actually produces sound, that mute actually silences it, that a tempo change doesn't jump the
playhead, and that playback doesn't write to storage every frame — not just that nothing threw. It also
verifies that a session saved by an older version migrates instead of crashing. Set `CHROMIUM_PATH` to
choose the browser binary.

---

## Free and Open Source

All dependencies are MIT, Apache-2.0, BSD-3-Clause, ISC, or CC-BY-4.0. No proprietary SDKs, analytics, or external API calls.

```bash
npm run audit:licenses   # verify the full dependency tree
```

See [LICENSES.md](LICENSES.md) for the complete inventory.
