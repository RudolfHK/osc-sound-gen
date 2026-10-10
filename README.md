# OSC — Digital Oscillator Synthesizer

A browser-based (and optionally desktop) music production app: an arrangement of tracks, clips and song sections; a piano roll and drum step sequencer; 223 synthesized instruments; a mixer with per-track EQ, sends and sidechain; master effects; automation; and an optional oscillator lab with a live oscilloscope. Everything is synthesized in real time by the Web Audio API — no sample files.

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

The repo ships with an Electron main process at `electron/main.cjs` and the tooling to package it —
`npm install` installs Electron and electron-builder along with everything else.

The desktop window runs sandboxed: context isolation on, no Node access in the page, a small
preload (`electron/preload.cjs`), a Content-Security-Policy that only allows the app's own files,
no navigation away from the app, and permission requests denied by default.

### 1. Run in dev mode (hot-reload)

Open two terminals:

```bash
# Terminal 1 — start Vite dev server
npm run dev

# Terminal 2 — launch Electron (connects to http://localhost:5173)
npm run electron:dev
```

### 2. Build a distributable installer

```bash
npm run electron:build      # installer for this platform
npm run electron:pack       # unpacked app only (quicker, for testing)
```

On Linux you can check a packaged build end to end — it launches the real app, plays an example
and exports an MP3:

```bash
npm run electron:pack && xvfb-run -a npm run test:electron
```

Output is placed in `release/`:

| Platform | File |
|----------|------|
| Windows  | `OSC Synthesizer Setup 1.0.0.exe` (NSIS installer, ~150 MB) |
| macOS    | `OSC Synthesizer-1.0.0.dmg` |
| Linux    | `OSC Synthesizer-1.0.0.AppImage` |

> **Icon**: `assets/icon.png` (1024×1024) is used for every platform; electron-builder derives the
> Windows `.ico` and macOS `.icns` from it. See [assets/ICONS.md](assets/ICONS.md) to replace it.
>
> **`npm audit`** reports a moderate advisory in `sprintf-js`, pulled in by electron-builder's
> download helper. It is a build-time tool only (nothing from it ships in the app) and no fixed
> version of `sprintf-js` exists.

For the complete Electron packaging guide including code signing and auto-updater, see [SHIPPING_PLAN.md](SHIPPING_PLAN.md).

---

## Features

### Getting started and help
- A **welcome screen** on first start: starter or empty project, five **genre templates** (tracks,
  sounds, mix and a looping beat, no notes), and the fifteen examples with genre, length and a
  one-line description — each with a **▶ preview** that plays without touching your session
- A six-step **guided tour** that points at each control and waits for you to use it
- **F1** opens this guide inside the app, at the section for the panel you're in; **?** lists every
  shortcut, searchable. Shortcuts, tooltips and menus come from one registry, so they always agree,
  and show ⌘/⌥ on a Mac
- **Light and dark themes** (☀ / ☾ in the header), visible keyboard focus, every control labelled for
  screen readers, no text under 11 px

### Arrangement
- **Tracks own their sound** — an instrument preset, a drum kit, or (optionally) an oscillator from the lab
- **Clips** on a timeline, each playing a looping **pattern**: drag to move (across tracks too), Alt-drag to copy,
  drag either edge to loop or trim, Ctrl+D to duplicate, Ctrl+E to split, per-clip mute, name and colour
- **Select several clips** (Shift-click, a selection box, Ctrl+A) and move, copy, duplicate, colour or
  delete them together; **Ctrl+C / Ctrl+V** pastes at the playhead, onto another track of the same kind
- **Linked or independent copies** — duplicates are independent by default, as in Ableton and Logic; linked
  clips share a pattern and show ⧉
- **Song sections** on the ruler (Intro, Verse, Drop…): duplicate a section with everything in it, delete one and
  close the gap, or loop it with one click
- Bar ruler: click to seek, drag to set the loop, right-click for play-from-here and loop points; loop
  start/end can also be typed as bar numbers; a loop only engages when the playhead reaches it
- Follow playhead: page, smooth scroll or off; type a bar or a time into the position display to jump
- Ctrl+wheel zoom around the cursor, Shift+wheel to scroll time, FIT to see the whole song
- Track headers with rename, colour, volume, mute/solo (additive), automation toggle and a ⋯ menu
- Undo/redo (↶/↷ in the transport, Ctrl+Z / Ctrl+Shift+Z) covers the whole song: clips, patterns,
  sections, automation, instruments and their per-track settings, every mixer control, drum patterns,
  master effects, tempo, meter, song length and loop. A fader drag counts as one step. Every step is
  **named** (*Undo Fader: Bass*), and a **History** list jumps several steps at once
- Stop and seek are immediate: held notes, queued notes and reverb/delay tails are cut within ~4 ms
- Starting or seeking into a held chord plays it straight away (note chase) instead of waiting for
  the next note

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
- **223 subtractive-synthesis presets** across eighteen categories:

  | Group | Categories |
  |-------|-----------|
  | Keyboards | Piano (6), Keys (12), Organ (10) |
  | Synths | Synth Lead (16), Synth Pad (16), Synth Bass (14), Synth Pluck (9) |
  | Guitars | Electric (14), Acoustic (9), Bass Guitar (8) |
  | Orchestral | Strings (15), Brass (13), Woodwind (17) |
  | Tuned percussion | Mallets (12), Plucked (15) |
  | Other | Vocal (10), World (15), FX (12) |

- Acoustic pianos, Rhodes/Wurlitzer, harmonium, tape flute and tape choir; church, drawbar,
  theatre, gospel and calliope organs
- Brass: trumpet, cornet, flugelhorn, trombone, bass trombone, euphonium, tuba, French horn,
  soft brass choir, mariachi trumpets
- Woodwind: flute, piccolo, recorder, tin whistle, ocarina, shakuhachi, pan flute, clarinet,
  bass clarinet, oboe, English horn, bassoon, soprano/alto/tenor/baritone sax, harmonica
- Strings: solo violin, viola, cello, double bass, legato violins, cello section, spiccato,
  pizzicato, tremolo, harmonics, sul ponticello, folk fiddle
- Mallets and bells: vibraphone, marimba, bass marimba, xylophone, glockenspiel, crotales,
  handbells, tubular and church bells, steel drum, timpani
- Plucked and world: harp, koto, guzheng, pipa, lute, zither, autoharp, cimbalom, balalaika,
  sitar, banjo, mandolin, ukulele, kalimba; erhu, sarangi, oud, bouzouki, shamisen, kora,
  santoor, charango, duduk, ney, dizi, gamelan, hang drum, didgeridoo, bagpipe
- Choirs: aahs, oohs, boys, male, breath and doo choirs, soprano, vocal pad, vocoder
- Genre essentials: **808 Cowbell** (the drift-phonk lead, playable as notes), **808 Glide** bass,
  **House Organ** stab, and a **Trap Hat** you play from the piano roll for 1/32 and triplet rolls
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
  independent reverb/delay/chorus sends, fader in dB (to +3.5 dB), pan, mute and solo
- **Real per-track meters** (post-fader peak), plus a master meter
- **Sidechain ducking** — any track can duck under the kicks on a drum track, which is
  what lets kick and bass share a downbeat without masking each other
- Mute acts as a gain, so it silences notes already ringing

### Visualizer (`VIZ`)
- **Off by default and not restored on reload** — it taps the master bus and runs a
  redraw loop, so it only costs CPU while you're watching it
- Four modes: log-spaced spectrum bars, waveform, radial, and concentric bloom
- Customizable sensitivity, smoothing, detail, motion trail, colour mode
  (theme / spectrum / mono), mirror, glow, and a 30/60 FPS cap (30 by default)

### Export
- **Offline render** — the arrangement is played into an `OfflineAudioContext` by the same instruments,
  drums, channel strips, effects and limiter that play it live, so an export sounds exactly like playback.
  It's sample-accurate and 4–13× faster than real time on the bundled examples
- **WAV** — 16-bit (with optional TPDF dither), 24-bit or 32-bit float; 44.1, 48 or 96 kHz
- **MP3** — 128–320 kbps CBR, stereo or mono, with ID3 title tags; encoded in a Web Worker
- **Stems** — one file per track that plays in the range, all the same length, each with its own
  effects, delivered as a ZIP
- **MIDI** — Standard MIDI File with a track per part, tempo, time signature and section markers; loops
  unrolled, arpeggios optionally baked, drums on channel 10 with General MIDI notes
- **Range** — whole song, the loop, or any section; reverb and release tails included, silence trimmed
- **Normalize** — off, peak (−1 dBFS), or **loudness** to a streaming target (−14 LUFS Spotify/YouTube,
  −16 Apple Music, −23 broadcast) measured per ITU-R BS.1770, never exceeding a −1 dBFS ceiling
- The dialog reports the export's peak and integrated loudness

### Live recording
- **● REC** captures the master output as raw PCM through an AudioWorklet — lossless, unlike the previous
  version, whose "WAV" was a decoded Opus stream
- Starts playback if stopped; stopping the transport ends the take
- The take opens in the export dialog, so it can be saved as WAV or MP3 with the same options (and
  saved again in another format)

### Oscillator Lab (optional)
- The original synth: **4 waveforms** (square with variable pulse width via a 256-harmonic Fourier series),
  logarithmic 20 Hz – 20 kHz frequency, phase, detune
- 60 fps oscilloscope with single and overlay (with SUM) modes
- Any lab oscillator can be a track's sound — polyphonic, with cutoff/resonance automation

### Saving and project safety
- **Session kept automatically** — the whole session lives in `localStorage`, written in debounced batches
  (never per frame) and restored after a reload or crash
- **Project files** (`.oscproject`, JSON) are self-contained: tracks, clips, patterns, sections, automation, mixer,
  plus the drum patterns and lab oscillators they use
- **Save in place** — in Chromium browsers and the desktop app, Ctrl+S writes back to the project's file
  (File System Access API); *Save as* picks a new one. Elsewhere Save downloads a copy and says so
- **Unsaved-changes guard** — opening, starting a new project, closing the tab or the desktop window ask
  *Save / Don't save / Cancel* when there's something to lose; the tab title shows • while unsaved
- Optional **autosave to file** every 1–10 minutes; a **crash screen** that can still save the song
- Older project files and saved sessions migrate automatically

### Status bar and settings
- Save state, audio state with **Enable audio**, sample rate and latency, **audio-thread load** measured by
  an AudioWorklet probe, a **dropout** counter, which area has the keys, and a hint for the control under
  the mouse
- **Eco mode** for slow machines (mono width, shorter tails, slower meters) — switches itself on after
  dropouts, with a notice and a *Turn off* button. Exports always render at full quality
- **Settings** (Ctrl+,): output device, latency, Eco mode; new-project tempo, grid, note length and
  template; follow playhead, keyboard-piano octave, metronome level, count-in; autosave; theme, accent and
  interface size (90–150 %)

### Example projects
Fifteen compositions ship with the app — open them from **OSC ▾ → Open example**, or find the files in
[`examples/`](examples/README.md). They include `midnight-drive`, an original French-touch study that uses
sections, looping clips, the arpeggiator, filter/resonance automation and sidechain together;
`midnight-drive-extended`, the same material grown into a full 98-bar song with builds, a breakdown,
a drop, a bridge with its own chord progression and an outro; seven Minecraft/C418-style pieces
(three of them full 1½-minute songs); two phonk tracks (808 cowbell lead, gliding 808, 1/32 hat
rolls); two deep-house tracks (minor-ninth Rhodes, organ stabs, swung hats); an ambient pad study; and a
fast arpeggio over techno drums. All are original compositions — genre and style studies, not covers.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Space** | Play / stop |
| **Home** | Return to start |
| **Ctrl+Z** / **Ctrl+Shift+Z** | Undo / redo |
| **Ctrl+S** / **Ctrl+Shift+S** / **Ctrl+O** | Save / save as / open project |
| **Ctrl+Shift+E** | Export audio or MIDI |
| **Alt+E / X / I / F** | Dock: Editor / Mixer / Instruments / FX |
| **Ctrl+,** · **?** · **F1** | Settings · all shortcuts · user guide |
| **Delete**, **Ctrl+D**, **Ctrl+E** | Delete / duplicate / split the selected clips *(arrangement)* |
| **Ctrl+A / C / V** | Select all / copy / paste clips *(arrangement)* |
| **M** / **S** | Mute / solo the selected track *(arrangement)* |
| **L** / **K** | Loop / metronome *(arrangement)* |
| **A W S E D F T G Y H U J K…** | Play notes *(editor)* |
| **↑ / ↓**, **Q**, **Ctrl+A/C/V** | Transpose, quantize, select/copy/paste notes *(editor)* |
| **B** / **V** | Draw / select mode *(editor)* |

Arrangement and editor shortcuts follow whichever you clicked last (the status bar shows which); none fire
while typing in a text field or while a dialog is open. On a Mac, Ctrl is ⌘ and Alt is ⌥. Press **?** in
the app for the full list, or see [GUIDE.md](GUIDE.md#keyboard-shortcuts).

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
| Export | `OfflineAudioContext` render, own WAV/MIDI/ID3 writers, LAME (LGPL, in a worker) for MP3, fflate for ZIP, BS.1770 loudness |
| Tests | Vitest (model, scheduler, migrations, encoders, loudness) + Playwright (end-to-end, including audio output and parsed exports) |
| Desktop | Electron (optional, see above) |

---

## Architecture

```
src/
├── arrange/
│   ├── ArrangementView.tsx  tracks, clip lanes, inline automation, playhead overlay, clip gestures
│   ├── useClipActions.ts    multi-clip delete / duplicate / copy / paste / split, clipboard
│   ├── Ruler.tsx            sections row + bar ruler with loop brace
│   ├── drawLane.ts          clip rendering (note/drum previews, loop markers)
│   └── geometry.ts          beat↔pixel maths, grid
├── engine/
│   ├── timeline.ts          pure event collection over loop-aware windows (unit-tested)
│   ├── sequencer.ts         scheduler: turns timeline events into Web Audio calls
│   ├── voices.ts            voice registry — cuts held/queued notes on stop and seek
│   ├── playhead.ts          live position outside React state
│   ├── emit.ts              timeline events → sound, shared by playback and export
│   ├── pcmRecorder.ts       lossless live recording (with pcm-tap.worklet.js)
│   ├── instruments.ts       223 presets, polyphonic preset + oscillator voices
│   ├── sampler.ts           33 synthesized drum voices
│   ├── channelStrip.ts      per-track EQ, fader, pan, sends, mute, sidechain, meters, instrument width/sends
│   ├── widener.ts           per-track mid/side stereo width (voices stay mono)
│   ├── audioHealth.ts       context state, latency, load probe (load-probe.worklet.js), dropouts
│   ├── effects.ts           master reverb, delay, chorus
│   ├── automation.ts        lane maths and AudioParam scheduling
│   ├── arpeggiator.ts       chord → arpeggio expansion
│   └── audio.ts             AudioContext, master bus + limiter, lab oscillators, offline swap
├── export/
│   ├── render.ts            offline render of the arrangement and stems
│   ├── exporter.ts          render → normalize → encode → zip
│   ├── wav.ts · midi.ts     WAV (16/24/32f) and Standard MIDI File writers
│   ├── mp3.ts · mp3.worker.ts  MP3 via LAME in a Web Worker, with ID3 tags (id3.ts)
│   └── loudness.ts          sample peak, BS.1770 integrated loudness, normalization
├── sequencer/
│   ├── PianoRoll.tsx        note editor for the selected clip
│   ├── TrackHeader.tsx      editor's pattern column + arpeggiator
│   ├── AutomationLane.tsx   breakpoint editor canvas
│   └── Mixer.tsx            channel strips
├── sampler/                 drum step sequencer, instrument library, FX panel
├── store/
│   ├── appStore.ts          document model reducer, named undo, debounced persistence, migration
│   ├── projectState.ts      unsaved-changes tracking, crash-screen serializer
│   ├── settings.ts          app preferences (Settings dialog)
│   └── …                    drum, instrument, effects and visualizer stores
├── ui/
│   ├── AppShell.tsx         header, view switch, engine sync, dialogs, desktop bridge
│   ├── shortcuts.ts         the shortcut registry: keys, scopes, labels, dispatch
│   ├── Transport.tsx        play/stop/record, named undo + history, typed position, tempo, loop
│   ├── StatusBar.tsx        save / audio / load / keys / hint, automatic Eco mode
│   ├── Welcome.tsx · Tour.tsx  start screen with templates and previews; guided tour
│   ├── SettingsDialog.tsx   settings
│   ├── help/                in-app guide (renders GUIDE.md) and the shortcuts overlay
│   ├── kit/                 Dialog, Button, confirm / choice / prompt dialogs
│   ├── theme.ts · scale.ts  light/dark theme, canvas colours; interface size
│   ├── ErrorBoundary.tsx    crash screen
│   ├── ExportDialog.tsx     export options, progress and level report
│   ├── Dock.tsx             editor / mixer / instruments / FX tabs
│   ├── OscLab.tsx           optional oscillator lab
│   └── …                    context menus, notices, focus scoping, project actions
├── utils/
│   ├── music.ts             track/clip/pattern/section model, MIDI and beat maths
│   └── project.ts           .oscproject v2 format, v1 + saved-session migration
└── visualizer/              oscilloscope and audio visualizer
e2e/smoke.mjs                browser tests (Playwright)
e2e/perf.mjs                 performance budgets (npm run test:perf)
examples/                    bundled projects
electron/main.cjs            Electron main process
```

---

## Testing

```bash
npm test                          # 124 unit tests: model, reducers, named undo, scheduler, migrations, examples,
                                  # templates, shortcuts, dirty tracking, encoders, loudness
npm run build && npm run test:e2e # 55 browser tests
npm run build && npm run test:perf  # performance budgets, normalised to the reference machine
npx electron-builder --linux dir && xvfb-run -a npm run test:electron   # 9 desktop tests
```

The browser suite drives the built app in Chromium and taps its audio output, so it checks that
playback actually produces sound, that mute actually silences it, that a tempo change doesn't jump the
playhead, and that playback doesn't write to storage every frame — not just that nothing threw. Every
export format is downloaded and parsed: WAV headers and sample peaks, MP3 frame sync and a decode back
to audio, ZIP contents and stem alignment, MIDI chunks, and the live take's float format. It also
verifies that a session saved by an older version migrates instead of crashing.

It also covers the help and safety features end to end: every registered shortcut has a handler, the
shortcut overlay and in-app guide, named undo and the History jump, the unsaved-changes guard, saving
over an opened file (with a mocked File System Access API) and the download fallback, the crash screen,
templates, example previews, the guided tour, the audio-state readout, settings surviving a reload,
multi-clip editing, and accessibility scans (no unlabeled control, no text under 11 px, focus kept
inside dialogs, keyboard menus). Set `CHROMIUM_PATH` to choose the browser binary.

`test:perf` renders a fixed calibration workload first and scales every result to the machine the
budgets were set on, so it judges the code rather than the computer: audio-thread load on the heaviest
passage ≤ 50 %, every example exporting ≥ 3× real time, no late notes on a 4× slower CPU, and frame
times with meters and visualizer open.

---

## Free and Open Source

All dependencies are MIT, Apache-2.0, BSD-3-Clause, ISC, or CC-BY-4.0. No proprietary SDKs, analytics, or external API calls.

```bash
npm run audit:licenses   # verify the full dependency tree
```

See [LICENSES.md](LICENSES.md) for the complete inventory.
