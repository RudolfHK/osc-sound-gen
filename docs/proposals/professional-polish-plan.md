# Verification, Performance Review and the "Professional Polish" Plan

*Status: **implemented** — all of C1–C10 shipped on this branch; see [Part E](#part-e--what-shipped)
for what was built, the decisions taken and the re-measured budgets.*
*Reviewed: `claude/oscillator-synthesizer-app-fUywi` at `1eb71c8` (October 2026), which holds the bug-fix
release (`ad5e3ac`) and the genre examples with the send-routing fix (`1eb71c8`).*

This document answers three questions: **do the latest features work without breaking anything**,
**is performance good enough for professional software**, and **what should be built next to make
the app feel professional** — with a design, effort and test plan for each chosen item. It
complements [`roadmap.md`](roadmap.md) (the feature roadmap F1–F20); where they overlap, this plan
says so.

---

## Part A — Do the new features work?

**Yes. Everything new works, and nothing older regressed.**

| Check | Result |
|---|---|
| Type check · 88 unit tests · production build | Pass |
| Browser end-to-end suite (37 steps, measured audio output) | Pass |
| Packaged desktop app (Electron, launched under Xvfb: loads, CSP clean, plays, exports MP3) | 5/5 |
| Hands-on QA of the new features (below) | 32/32 (one check first failed on a mistake in the QA script — it collapsed the dock — and passed once corrected) |
| Console errors or warnings during all of the above | None |

Hands-on QA covered what the e2e suite doesn't:

| Feature | What was checked | Result |
|---|---|---|
| All 15 examples | Load from the menu, play, measured output | All audible (peaks 0.34–0.81), no errors |
| Project effects | Loading *Neon Drift* applies its own reverb (1.6 s) and delay (1/8.) | Pass |
| Per-track instrument settings | Example patches load; the library editor opens in **TRACK** scope for the selected track; a slider writes the track's patch; **Undo** restores it | Pass |
| Undo across stores | Master FX change, song length, drum step, tempo — each undone | Pass |
| Fader covers instrument sends | Soloed piano with its own reverb: fader 0 → peak 0.0000, fader 1 → 0.37 | Pass |
| Drum-pattern delete | Pattern used by a clip: 5 clips → 4 → one **Undo** → 5 | Pass |
| Save → New → Open | Effects and per-track settings survive the round trip; New resets effects | Pass |
| Reload | Session restores per-track settings and effects | Pass |
| New instruments | 808 Cowbell, 808 Glide, House Organ, Trap Hat audition | All audible |

### Bugs found while checking (none in the new features)

All confirmed in the code; all small. They are task 0 of the plan (§C1).

| # | Bug | Where |
|---|---|---|
| Q1 | Tooltips advertise **B** (draw) and **V** (select), but neither key does anything | `Dock.tsx` (tooltip); no handler anywhere |
| Q2 | Global shortcuts stay live behind the Export dialog — **Space** starts playback while it's open | `AppShell.tsx` key handler has no dialog guard |
| Q3 | Opening an example or a file replaces the session **without asking** (only *New project* asks) | `useProjectActions.ts` |
| Q4 | **Ctrl+D / Ctrl+E** with no clip selected fall through to the browser (bookmark, search bar) | `AppShell.tsx` |
| Q5 | The **DRUM SENDS** rack's on/off toggle does nothing | `EffectsPanel.tsx` |
| Q6 | A disabled slider (pulse width when not square) still moves from the keyboard | `controls.tsx` (`pointer-events-none` only) |
| Q7 | Alt+E/X/I/F read `e.key`, which macOS's Option key turns into other characters — likely broken on Mac | `AppShell.tsx` |
| Q8 | Every FX knob, the visualizer sliders and several drum controls have no accessible label | `EffectsPanel.tsx`, `VisualizerPanel.tsx`, `DrumMachine.tsx` |
| Q9 | GUIDE says autosave is "skipped during playback"; it is debounced, not skipped | `GUIDE.md` |

---

## Part B — Is performance good enough?

### Method

The heaviest projects were played in Chromium 141 on the 4-core build machine, at normal speed and
with the CPU throttled 4× (a modest laptop). Measured: frame times, long tasks, how far ahead each
note is queued, audio dropouts (Chrome's `playoutStats.fallbackFramesEvents`), audio nodes created,
heap and DOM size over a 2-minute session, startup, interaction latency, and offline render speed.
The offline render was profiled to split main-thread JavaScript from audio rendering, and re-run
with one cost removed at a time (each in a fresh page, baseline run first and last).

Caveat: headless Chromium plays to a fake audio device and the machine is shared, so dropout counts
are indicative; the relative costs and the offline numbers are solid.

### Budgets and results

| Budget | Target | Measured | Verdict |
|---|---|---|---|
| UI during playback | p95 frame ≤ 16.7 ms, no long tasks | p95 16.7–16.8 ms on every song, 0 long tasks | **Pass** |
| UI on a slow machine (4× CPU) | p95 ≤ 33 ms | 16.8 ms normally; **50 ms (≈ 20–30 fps) with mixer meters + visualizer open**, 5 long tasks ≤ 61 ms | **Partial** |
| Note scheduling, normal speed | every note queued ≥ 20 ms ahead | 80–93 ms minimum lead | **Pass** |
| Note scheduling, 4× CPU | no late notes | Extended 69 ms, Lanterns 16 ms ✓ — **Velvet Hours −11.6 ms (35 notes < 5 ms), Neon Drift −2.9 ms (15)** | **Fail** on dense songs |
| Audio dropouts, normal speed | none | 0 on most songs — **Neon Drift 5 (50 ms); Extended with meters + visualizer 7 (70 ms)** | **Fail** |
| Audio-thread load (heaviest example) | ≤ 50 % of a core | **Midnight Drive (Extended) Drop: 63–66 %**; Neon Drift Drop B 48 % | **Fail** |
| Export speed | ≥ 3× real time | **Extended 1.4×**, Velvet 2.1×, Neon 2.5×, Lanterns 3.9× | **Fail** |
| Memory, 2 min looped playback with meters + visualizer | heap growth < 10 %, DOM stable | heap 11.1–11.7 MB, DOM 801 nodes constant | **Pass** |
| Startup | first paint < 1 s, main JS < 150 KB gzip | first contentful paint 244 ms, 130 KB JS | **Pass** |
| Interaction latency | ≤ 100 ms (≤ 200 ms is "good" INP) | undo 56, FX tab 63, instruments tab (223 cards) 81, first export dialog 131, load 11-track example 162, **mixer tab 165** | **Mostly pass** |
| Fader drag | no dropped frames | worst frame 17 ms | **Pass** |

### Diagnosis

**1. The audio graph, not JavaScript, is the bottleneck.** Profiling the full Extended render: 137 s
of render for 202 s of audio, of which **main-thread JavaScript is 1.3 s (1 %)** — the rest is the
browser's audio engine running the graph. Every note builds its own graph (≈ 13–23 nodes), so cost
scales with *simultaneous voices × nodes per voice*. The Extended render created 58,284 nodes
(288 per second of audio): 27,906 gains, 13,372 stereo panners, 10,024 oscillators.

**2. What the load is made of** (Extended, Drop, 25 s; each row removes one thing):

| Variant | Audio-thread load |
|---|---|
| Baseline | 63–66 % |
| No per-layer stereo-width panners | **54 %** (−10 points) |
| Short releases (fewer overlapping voices) | 59 % |
| No per-voice preset sends | 59 % |
| No drive (waveshapers) | ≈ baseline |
| 0.3 s reverb instead of 2.2 s | ≈ baseline |
| No limiter | ≈ baseline |

So the wins are structural: fewer nodes per voice (the per-layer width panners alone are ~15 % of
the load), fewer overlapping voices, and per-track rather than per-voice processing where the sound
doesn't need to be per note.

**3. Late notes on slow machines** come from note-dense bars (Velvet's four-note stabs five times a
bar, Neon's 1/32 hat rolls on an 18-node hat preset) meeting a main thread that is occasionally
stalled for 150–250 ms (frame maxima at 4×). The adaptive lookahead widens *after* a late tick; it
doesn't anticipate dense passages.

**4. Mixer meters and the visualizer** are the UI's only heavy consumers on slow machines: meters
redraw every frame for every strip, the visualizer runs FFT drawing with shadow blur.

---

## Part C — The plan

Ideas came from three sources: the UX audit done for this review (onboarding, help, feedback,
consistency, settings, accessibility), the measurements above, and the existing roadmap. The chosen
set is a **"Professional polish" release** — the things that make the app feel finished — plus the
performance work the budgets call for. Larger features (MIDI, inserts, audio) stay in
[`roadmap.md`](roadmap.md) and come after.

Effort is in focused developer-days.

### C1. Fix pass — the bugs above · 1.5 days

Q1–Q9, plus the small label and wording issues found in the audit:
- Implement **B** / **V** for the editor modes (or drop them from the tooltip).
- Pause global shortcuts while any dialog or menu is open (one `isOverlayOpen()` check).
- Ctrl+D / Ctrl+E: always `preventDefault`.
- Remove the dead DRUM SENDS toggle (show the rack without one).
- Disabled sliders get the `disabled` attribute.
- Shortcuts read physical keys (`e.code`) so Alt shortcuts work with macOS's Option.
- Add `aria-label`s to every unlabeled control; show units on fader values (dB) and on the free delay time (ms).
- Correct the GUIDE.

**Acceptance:** each item has an e2e or unit check (e.g. Space while the Export dialog is open
doesn't start playback; Alt+X opens the mixer with a Mac-style keyboard event).

### C2. Help that lives in the app · 4 days

**Problem.** The 900-line guide is unreachable from inside the app; shortcuts are only discoverable
by reading it; tooltips mention some keys and not others, always as "Ctrl" even on a Mac.

**Design.**
- **One shortcut registry** (`src/ui/shortcuts.ts`): id, keys (physical), label, scope (global /
  arrangement / editor), handler. The global key handler, tooltips, menus and the overlay all read
  it, so a shortcut can't be documented and missing again (Q1), and labels render as ⌘/⌥ on a Mac.
- **"?" overlay**: every shortcut grouped by area, searchable, highlighting the ones that work in
  the area that currently owns the keyboard.
- **Help panel** (F1 key or **?** button in the header): the GUIDE rendered in the app — bundled as
  Markdown at build time, split by heading, searchable — opening at the section for whatever panel
  has focus ("help for the mixer" opens *The Mixer*). In the desktop app, a **Help** menu with the
  same entries.
- **Hover hints**: the status bar (C4) shows a one-line explanation of the control under the mouse,
  taken from its tooltip, replacing the scattered 9 px hint bars.

```
┌ Keyboard shortcuts ─────────────────────────────── [ search… ] ✕ ┐
│ TRANSPORT              ARRANGEMENT (active)     EDITOR            │
│ Space   Play / stop    ⌫      Delete clip       A–;  Piano keys   │
│ Home    To start       ⌘D     Duplicate clip    B    Draw mode    │
│ ⌘Z      Undo           ⌘E     Split at playhead V    Select mode  │
│ ⇧⌘Z     Redo           M / S  Mute / solo track Q    Quantize     │
│ ⌘S      Save           ↑ ↓    Select track      ⌘C/⌘V Copy/paste  │
│ ⇧⌘E     Export         L / K  Loop / metronome  ⌫    Delete notes │
│                                         Open the full guide (F1) →│
└───────────────────────────────────────────────────────────────────┘
```

**Seams.** `AppShell.tsx` key handler → registry dispatch; `focus.ts` zones become registry
scopes; tooltip strings in components built from the registry (`shortcutLabel('clip.duplicate')`);
`vite.config.ts` imports `GUIDE.md?raw`. **Roadmap:** F20 (command palette, rebinding) builds on the
same registry later.

**Acceptance.** Every registry entry has a working handler (unit test iterates the registry); the
overlay lists only registered shortcuts; F1 on the mixer opens the mixer section; Mac labels render
with a Mac user agent. **Tests:** unit (registry/handlers), e2e (open overlay with "?", search,
F1 context).

### C3. First run, examples and templates · 3 days

**Problem.** A new user lands on four empty tracks; pressing Space plays silence. Fifteen examples
hide under the logo menu as lowercase file names with no descriptions.

**Design.** A **Welcome / New** screen — on first run, from *New project*, and from an empty session:

```
┌ OSC ───────────────────────────────────────────────────────────────┐
│  Start something                       Or open an example           │
│  ┌──────────┐ ┌──────────┐ ┌────────┐  ▶ Midnight Drive (Extended)  │
│  │  Empty   │ │ Starter  │ │ Open…  │    French-touch, 3:20 · tour   │
│  └──────────┘ └──────────┘ └────────┘  ▶ Neon Drift · phonk, 1:29    │
│  Templates                             ▶ Velvet Hours · deep house   │
│  [ House 122 ] [ Phonk 140 ] [ Lo-fi ]  ▶ Morning Meadow · ambient    │
│  [ Ambient 72 ] [ Minecraft-style ]     … all 15, with one-line notes │
│                                                                     │
│  New here? Take the 2-minute tour →     ☐ Show this on start        │
└─────────────────────────────────────────────────────────────────────┘
```

- Examples get a **title, genre, length and one-line description** (a small manifest next to the
  files; the menu shows them too), and a **▶ preview** that plays the first bars without replacing
  the session.
- **Templates** are projects with tracks, instruments, drum patterns, tempo and FX set up but no
  notes — the genre examples minus their clips.
- **Guided tour** (optional, 6 steps): play an example → open a clip in the piano roll → draw a
  note → change an instrument → mix → export. Each step highlights the control and waits for the
  user to do it.

**Seams.** New `src/ui/Welcome.tsx`; `useProjectActions` gains `newFromTemplate`; examples manifest
in `examples/index.json`; tour state in localStorage. **Acceptance:** first visit shows Welcome;
choosing a template gives a playable project with no notes; preview doesn't touch the session;
the tour completes end to end. **Tests:** e2e for each path.

### C4. Status bar and audio health · 3 days

**Problem.** The app never says whether the session is saved, whether audio is running or blocked,
how loaded the audio engine is, or which area owns the keyboard.

```
● Saved · Neon Drift   │ Audio 44.1 kHz · 31 ms │ Load ▮▮▮▯▯ 48 %  0 dropouts │ Keys: Arrangement │ Hover: Drag to move · Alt-drag to copy
```

- **Save state** (Saved / Unsaved changes / Saving…), plus the project name in the browser tab
  title with a • when unsaved.
- **Audio state**: running / suspended — with a one-click "Enable audio" when the browser blocked
  it — sample rate and output latency (`baseLatency + outputLatency`).
- **Load meter**: estimated audio-thread load. Primary source: a tiny AudioWorklet probe that
  measures render-callback timing; where Chrome's `playoutStats` exists, also a **dropout count**
  that turns amber on the first glitch, with a tooltip suggesting Eco mode (C7).
- **Keys owner** (arrangement / editor) — the invisible mode that changes what M, S, L and K do.
- **Hover hint** (from C2).

**Seams.** New `src/ui/StatusBar.tsx` under the dock; `audio.ts` exposes context state and
latency; `src/engine/loadProbe.ts` + `load-probe.worklet.js` (same loading pattern as the PCM
recorder); save state derived from a "dirty since last save" counter in the app store.
**Acceptance:** suspending the context shows "Enable audio" and clicking it resumes; editing marks
Unsaved and saving clears it; the load meter rises with the Extended example's drop.
**Tests:** e2e (state transitions); unit (dirty counter).

### C5. Project safety · 3 days

**Problem.** Work can be lost: Open/Example replace the session silently (Q3), Save always
downloads a new file, and a render error shows a blank page.

- **Unsaved-changes guard**: Open, Example, New and closing the desktop window ask
  *Save / Don't save / Cancel* — or, when nothing changed since the last save, don't ask.
- **Save in place**: with the File System Access API (Chromium, desktop app), Ctrl+S writes back to
  the file that was opened; *Save as…* picks a new one. Other browsers keep downloading.
- **Crash screen**: a React error boundary that offers *Save project*, *Reload* and *Copy error
  report* instead of a blank page.
- **Autosaved versions** belong to roadmap F14 (project library) and build on this.

**Seams.** `useProjectActions` (guarded actions, file handle), `electron/main.cjs` (`close` event →
renderer asks), `src/ui/ErrorBoundary.tsx`. **Acceptance:** each replace-the-session path asks
exactly when there are unsaved changes; Ctrl+S after Open overwrites (Chromium); a thrown render
error shows the crash screen and *Save project* produces a valid file. **Tests:** e2e (guard
dialogs, error boundary via a test hook), unit (dirty tracking).

### C6. Named undo and history · 2 days

**Problem.** Undo works across the whole song but never says *what* it will undo.

- Each undo step carries a label ("Move clip", "Fader: Bass", "Delete drum pattern"). The
  ↶ / ↷ tooltips read **Undo Move clip**; undoing shows a brief notice with a **Redo** button.
- A **History** list (from the ↶ button's menu) — click a step to jump there.

**Seams.** `UndoEntry` gains `label`; `SEQ_PUSH_UNDO` and `requestUndoStep` take a label;
`autoUndoKey` maps actions to labels. **Acceptance:** every user-visible edit produces a labelled
step (unit test over the action list); jumping in History equals repeated undo. **Tests:** unit +
one e2e.

### C7. Performance package · 6–8 days

From Part B, in order of payoff:

| # | Change | Expected effect | Days |
|---|---|---|---|
| P-a | **Stereo width per voice without per-layer panners**: sum layers into two buses (L/R gains + one `ChannelMerger`) instead of one `StereoPanner` per layer | ≈ −10 points audio load (−15 %) on wide presets | 1.5 |
| P-b | **Drop the per-voice panner** when the track's strip handles pan, and connect preset sends from the strip (one set per track) instead of per voice where the preset doesn't vary them per note | −5 points, ~3 fewer nodes per note | 1.5 |
| P-c | **Release-aware voice budget**: steal voices that are only releasing first; cap release tails per track | fewer overlapping voices in dense parts | 1 |
| P-d | **Dense-passage scheduling**: size the lookahead from the next window's note count and the measured per-note cost, not only from late ticks | no late notes at 4× CPU on Velvet / Neon | 1 |
| P-e | **Meters and visualizer**: 30 fps cap, skip hidden strips, no `shadowBlur`, `OffscreenCanvas` where available | 4× CPU p95 back under 33 ms with both open | 1 |
| P-f | **Eco mode** (status-bar toggle and setting): mono width, shorter tails, half-rate meters | headroom on weak machines | 0.5 |
| P-g | **Perf regression test** (`npm run test:perf`): the harness from this review with the budgets as thresholds | budgets stay met | 1 |

**Acceptance:** the budget table in Part B re-measured — audio load on the Extended drop ≤ 50 %,
export ≥ 3× real time on every example, no late notes at 4× CPU, 0 dropouts at normal speed,
p95 ≤ 33 ms at 4× with meters and visualizer open. The longer-term structural fix — rendering voices
in an AudioWorklet — remains roadmap **F18**, to be started only if P-a…P-f don't reach the budgets.

### C8. A consistent, accessible interface · 5 days

**Problem.** 126 hard-coded colours and six near-black backgrounds; 46 text sizes under 11 px;
`text-neutral-600/700` hints at 1.9–2.5:1 contrast; no visible focus ring; three popover
implementations; five native `confirm()` dialogs; mixed casing and glyph-only buttons.

- **Design tokens** (CSS variables in `index.css`, mirrored in a small TS module for canvases):
  surface / raised / border / text / muted / accent / danger, spacing and type scale. Minimum text
  11 px, body contrast ≥ 4.5:1, hints ≥ 3:1.
- **Themes**: dark (today), **light** and **high-contrast**, chosen in Settings (C9).
- **Primitives**: `Button`, `IconButton` (glyph + accessible name + tooltip), `Toggle`, `Menu`
  (keyboard navigation, submenus that flip at screen edges), `Popover`, `Dialog` (focus trap and
  return, pauses global shortcuts), `ConfirmDialog` replacing the five `window.confirm` calls —
  and offering **Undo** instead of a question where the action is undoable.
- **Visible focus ring**, `prefers-reduced-motion` respected, keyboard-reachable instrument cards
  and lab tabs.

**Seams.** `index.css`, new `src/ui/kit/`, then a pass over every component (mechanical).
**Acceptance:** automated contrast and label checks in the e2e (no unlabeled controls, no text
under 11 px in the DOM, contrast of token pairs computed); the export dialog traps focus; menus
work from the keyboard. **Roadmap:** F17 (keyboard-operable canvases) builds on this.

### C9. Settings · 3 days

A **Settings** dialog (⌘, / gear in the header):

| Section | Settings |
|---|---|
| Audio | Output device (`setSinkId`), latency (*interactive* / *balanced* / *playback*), Eco mode |
| New projects | Default tempo, grid, note length, template |
| Editing | Follow playhead (page / scroll / off), keyboard-piano octave, metronome level, count-in |
| Saving | Autosave on/off and interval (with F14: versions to keep) |
| Appearance | Theme (C8), UI scale (90–150 %), accent colour |

**Seams.** New `settingsStore` (persisted), consumers read from it (`audio.ts` context creation,
`ArrangementView` follow mode, `PianoRoll` octave, sequencer metronome gain).
**Acceptance:** each setting changes behaviour and survives reload; changing the output device moves
audio without a reload (where supported). **Roadmap:** F1 (MIDI) adds its device list here.

### C10. Editing quality of life · 3 days

- **Arrangement**: select several clips (Shift/box), copy/paste clips, rename and recolour a clip,
  right-click menu on the ruler (add section, set loop, play from here). *(Notes-level tools are
  roadmap F2.)*
- **Editable readouts**: type a bar into the position display to jump; numeric loop start/end;
  a follow-playhead toggle beside the zoom buttons.

**Acceptance:** e2e for multi-select move, copy/paste across tracks, typed seek.

---

## Part D — Order and size

```
C1  Fix pass                                   1.5 d   ← first, cheap, removes rough edges
C7  Performance package                        6–8 d   ← the budgets that fail today
C8  Consistent, accessible interface           5 d     ← tokens + primitives make C2–C6 faster
C2  Help in the app                            4 d
C4  Status bar and audio health                3 d
C5  Project safety                             3 d
C3  First run, examples, templates             3 d
C6  Named undo and history                     2 d
C9  Settings                                   3 d
C10 Editing quality of life                    3 d
                                               ≈ 34–36 days (7 weeks)
```

After this release, continue with the roadmap's **MIDI release** (F1 Web MIDI, F2 composition aids,
F3 MIDI import): C9 gives MIDI its settings page and C2's registry gives it shortcuts.

Every item ships with the same bar as previous releases: unit tests for logic, an e2e step per
user-visible behaviour (audio measured where relevant), the perf budgets re-run (C7's
`test:perf`), GUIDE and README updated, and the desktop smoke test.

### Decisions for you

1. **Welcome screen on every start, or first run only?** (Proposed: first run, then from *New*,
   with a checkbox.)
2. **Light theme now, or high-contrast only?** A light theme touches every canvas renderer.
3. **Eco mode default**: off everywhere, or switched on automatically when dropouts are detected?
4. **Save in place** needs the File System Access API: fine to have it in Chromium and the desktop
   app only, with downloads elsewhere?

**Decided:** 1 — first start only (then from *New project…*, *Help → Welcome screen*, or a Settings
checkbox). 2 — light and dark, with a switch in the header; dark stays the default. 3 — Eco mode
switches itself on when dropouts are detected, with a notice and a *Turn off* button. 4 — save in
place where the File System Access API exists; elsewhere Save downloads and says so every time.

---

## Part E — What shipped

| Item | Built | Tests |
|---|---|---|
| **C1** fix pass | Q1 B/V editor modes; Q2 shortcuts pause behind dialogs and menus; Q3 guard before replacing the song; Q4 Ctrl+D/E never reach the browser; Q5 dead DRUM SENDS toggle removed; Q6 disabled sliders disabled for real; Q7 Alt shortcuts by physical key; Q8 every control labelled, dB on faders, ms on the free delay; Q9 GUIDE autosave wording | e2e: Space behind Export, Option+X, registry handlers; unit: key matching |
| **C2** help in the app | Shortcut registry (tooltips, menus, overlay, ⌘⌥ labels); **?** overlay with search; F1 guide panel opening at the focused panel; desktop File and Help menus | e2e: overlay search, F1 at the mixer; desktop: Help menu command |
| **C3** first run | Welcome screen (first start), examples manifest with genre/length/description and ▶ preview, five templates, six-step tour | unit: manifest and templates; e2e: welcome, template, preview, full tour |
| **C4** status bar | Save state, audio state + Enable audio, sample rate/latency, AudioWorklet load probe, dropout count, keys owner, hover hint, automatic Eco mode | e2e: unsaved state, suspend → Enable audio |
| **C5** project safety | Dirty tracking (by reference, survives reload), Save/Don't save/Cancel guard on open/example/new/tab close/desktop close, save in place + Save as, download fallback notice, crash screen | unit: dirty tracking; e2e: guard, fallback, mocked save-in-place, crash screen; desktop: close guard |
| **C6** named undo | Every step named (*Fader: Bass*), Undo/Redo notices, History list with multi-step jumps | unit: labels for every edit, jump = repeated undo; e2e: History jump |
| **C7** performance | P-a mono voices + per-track mid/side width; P-b no per-voice panner or sends on a strip (drums too), per-track body EQ, shared layer gains; P-c release-aware stealing + tail cap; P-d density-aware lookahead; P-e meters 30 fps/culled, visualizer 30 fps, glow without shadow blur; P-f Eco mode; P-g `npm run test:perf` | perf test (below); levels match the old engine within 0.6 dB per track |
| **C8** interface | Light/dark themes over mirrored ramps, surface tokens, focus ring, 11 px minimum, Dialog/Button/Menu primitives, keyboard menus with flipping submenus, keyboard-reachable instrument cards | e2e: no unlabeled control or small text, focus trap, keyboard menus; contrast measured |
| **C9** settings | Output device, latency, Eco; new-project defaults and template; follow playhead, keyboard octave, metronome level, count-in; autosave to file; theme, accent, interface size | e2e: settings survive a reload; desktop: interface size is page zoom |
| **C10** editing | Multi-clip selection (Shift-click, box, ⌘A), group move/copy/delete/colour, clip copy/paste across tracks, clip rename and colour, ruler menu, loop fields, follow toggle, typed seek | unit: clip reducers, position parser; e2e: box select, group move, paste onto another track |

### Budgets, re-measured

Normalised to the reference machine (`npm run test:perf` calibrates first; the run below was on a
machine 2.4× slower than the reference).

| Budget | Target | Before | Now |
|---|---|---|---|
| Audio-thread load, Midnight Drive (Extended) drop | ≤ 50 % | 63–66 % | **33–39 %** |
| Export speed, every example (whole song) | ≥ 3× | Extended 1.4×, Velvet 2.1×, Neon 2.5× | **4.0–13×** (Low Tide 4.0×, Memphis Fog 4.1×, Velvet 4.2×, Extended 4.4×) |
| Late notes on a 4× slower CPU | none | Velvet 35, Neon 15 | **0** (Extended, Velvet, Neon) |
| Frame p95, 4× slower CPU, mixer meters + visualizer open | ≤ 33 ms | 50 ms | **16.7 ms** |
| Dropouts at normal speed | none | Neon 5, Extended + meters + viz 7 | Not judged on this machine — a 2.4× slower audio thread can't be scaled; measured 0 on Velvet, 3 on Neon and 5–8 on Extended + meters + visualizer through the headless fake device. Re-run on reference-speed hardware |

Contrast (both themes): body text ≥ 9:1, hints ≥ 3.8:1, the light theme's accent 5.3:1.

### Deviations from the plan

- **High-contrast theme** was not built: decision 2 chose light and dark.
- **Latency** applies after a restart — an AudioContext's latency is fixed when it is created, and
  rebuilding every engine's graph live wasn't worth the risk.
- **Interface size** is real page zoom in the desktop app; in browsers it is CSS zoom with pointer
  and popup coordinates converted (the browser's own Ctrl +/− also works).
- **Stereo width** is now a per-track mid/side widener instead of per-layer panning. Levels match the
  old engine, but the stereo image is a little different: the side signal is a delayed, high-passed
  copy, so bass stays centred and the mix stays mono-compatible.
- The hover hint was added to the status bar; the existing hint lines stay (now at 11 px).

