# State of the App and Feature Roadmap

*Status: the bugs and debt in §2 are fixed (see §2.3); the features in §3 onward are plan only.*
*Reviewed: `main` at `baf47eb` (October 2026).*
*Next: [`professional-polish-plan.md`](professional-polish-plan.md) re-verifies the app after these fixes,
re-measures performance against budgets, and plans a "professional polish" release to do before
the MIDI release below.*

This is the result of three passes over the app: the automated test suites, a hands-on QA run that
drives the real app in Chromium and measures its audio output, and a read-only code audit of every
engine, store and UI module. It answers two questions: **does the app work**, and **what would make it
better** — with an effort estimate and a design sketch for each candidate, ordered into a roadmap.

Effort is in focused developer-days for someone who knows this codebase. Impact is 1–5 for a person
making music with the app.

---

## 1. Verdict

**The app works.** Every path a musician uses end to end — arranging, editing notes and drums,
choosing instruments, mixing, automation, effects, exporting, recording, saving and reopening — works,
produces sound, and throws no errors. Performance is comfortable on a normal machine.

It has **a handful of real bugs**, none of which corrupt work, and some **structural debt** that
should be paid before the next large features, because those features build on exactly the seams
where the debt sits (effect chains, per-track instrument settings, the scheduler).

### What was verified

| Check | Result |
|---|---|
| Type check, 60 unit tests, production build | Pass |
| 32-step end-to-end suite (UI + measured audio output) | Pass |
| All 8 bundled examples load and produce sound | Pass — peaks 0.55–0.84, no console errors |
| Stop / seek / volume act within ~90 ms | Pass (measured, from the last release) |
| Instrument library: 219 presets render, audition, parameter editor | Pass |
| Computer-keyboard piano in the editor | Pass |
| Save → reopen round trip | Pass — 6 tracks out, 6 tracks back |
| Export: WAV 16/24/32f, MP3, stems, MIDI, loudness normalisation | Pass |
| Live recording (lossless) | Pass |
| Initial load (local) | 55 ms to interactive; bundle 494 KB (142 KB gzipped) |
| Playback of the heaviest song (Extended, at the Drop) | 60 fps (p95 frame 16.7 ms), no long tasks, ~400 audio nodes/s, heap flat at ~11 MB |
| Same, visualizer on / mixer meters on | 60 fps, no long tasks |
| Same, CPU throttled 4× (a slow laptop) | **3 of 539 notes scheduled < 5 ms ahead, one 3 ms late; one 133 ms frame** |
| Layout at 1440 px | Pass |
| Layout at 1280 / 1024 / 768 / 390 px | **Header wraps onto 2 or more rows** (73–259 px tall), squeezing the arrangement |
| Accessibility quick scan | All 699 buttons named, Tab reaches Play in 4 steps, visible focus. **4 controls unlabeled, 7 of 8 canvases unlabeled and mouse-only** |
| Oscillator lab: tone, scope | Sound and scope work. **The PLAY button never changes to STOP** |

---

## 2. Bugs and debt — fix first

Items marked **verified** were reproduced in the browser or confirmed by reading the code during this
review. The rest come from the code audit, with the evidence named, and should be confirmed with a
failing test before fixing.

### 2.1 Bugs a user can run into

| # | Problem | Evidence | Fix | Effort |
|---|---|---|---|---|
| B1 | **Oscillator lab PLAY button never shows STOP.** The button reads `tab.oscillator.isPlaying`; playing sets `tab.isPlaying`. A second click does stop the tone, but the label always says PLAY. Introduced when tracks were decoupled from oscillators. | Verified (`controls.tsx` `PlayStopButton isPlaying={state.isPlaying}` vs `OscLab.tsx` `togglePlay`) | Pass the tab's flag; drop the duplicate field from `OscillatorState` | 0.1 |
| B2 | **Header wraps below ~1440 px.** The transport row (now with undo/redo) no longer fits; at 1024 px the header is 107 px tall, on a phone 259 px. | Verified (screenshots) | Collapse BPM/meter/loop/click into a compact group, hide labels below 1280 px, move EXPORT into the File menu on narrow screens | 0.5 |
| B3 | **Seeking into a held note is silent** until the next note starts (no note chase). Pressing play in the middle of a pad chord gives silence for up to a bar. | Verified (`timeline.ts` only emits notes that *start* in the window) | On play/seek, emit notes that started before the position and are still held, with a shortened duration and a short fade-in | 1 |
| B4 | **Exporting leaks audio nodes into the live session.** On the offline context swap the effects bus and channel strips are rebuilt without disposing the old ones; the old chorus LFOs keep running. Every export (and every stem) adds another orphaned set. | Verified (`EffectsBus.ensure` rebuilds when the context changes; nothing disconnects or stops the old graph) | Give each engine a `dispose()` and call it in `beginOffline` / `endOffline` | 0.5–1 |
| B5 | **The drum editor's AUDITION writes the whole drum library to localStorage every animation frame** and re-renders the app at 60 Hz while it runs. | Verified (`DRUM_SET_CURRENT_STEP` dispatched per frame; reducer always returns a new object; persistence effect on every state) | Dispatch only when the step changes; keep `currentStep` out of the persisted state; debounce persistence like the main store | 0.3 |
| B6 | **A kick ducks sidechained tracks twice**, and because events in one window aren't time-sorted, an earlier kick can cancel a later kick's duck. | Verified (`emit.ts` and `DrumSynth.trigger` both call `duckAll`) | Duck in one place; sort a window's events by time | 0.2 |
| B7 | **Project files leave out the master FX and instrument tweaks**, so a song reopened elsewhere sounds different. Tweaks are global per preset, so two tracks can't use the same preset with different settings. | Verified (`ProjectV2` has no effects or instrument fields) | Save the FX rack in the project; move instrument tweaks onto `Track` as a per-track patch (also unlocks F8) | 1.5 |
| B8 | **Undo misses some edits**: drum pattern edits, tempo/meter/loop/song length, master FX, instrument tweaks. Undoing a section delete doesn't restore the song length. The README says undo covers the whole document. | Audit (`DocSnapshot` = tracks, patterns, markers only) | Extend the snapshot to the song settings and drum patterns; move FX and patch edits into undoable state; correct the README | 1 |
| B9 | **Notes can land late under heavy load**, and after a stalled tab all overdue notes fire together. The scheduler ticks on the main thread with a fixed 120 ms lookahead. | Verified (4× throttle: one note 3 ms late); audit (no catch-up guard for notes) | Drive the tick from a Worker timer (not throttled in background tabs), widen the lookahead when ticks run late, drop notes more than ~50 ms overdue instead of bunching them | 1 |
| B10 | **Play/stop race**: stopping while play is still awaiting the audio context leaves audio running with the UI showing stopped. Same in the drum editor. | Audit | Generation counter checked after each `await` | 0.2 |
| B11 | **The drum editor's AUDITION can play into an export.** | Audit (its scheduler reads the current, offline, context) | Stop every scheduler before rendering; refuse to schedule into an offline context | 0.2 |
| B12 | **Deleting a drum pattern silently empties the clips that use it**, and can't be undone. | Audit | Warn with a usage count (as oscillator tabs do); make it undoable via B8 | 0.3 |
| B13 | **The session can silently stop saving.** Note patterns orphaned by deleting clips and tracks are never removed, and a storage quota error is swallowed. | Audit | Garbage-collect unreferenced patterns on save; surface a quota error as a notice; move the session to IndexedDB (see F14) | 0.5 |
| B14 | **`electron:build` cannot work**: `electron` and `electron-builder` aren't dependencies, there are no icons, no preload script and no CSP. | Verified (`package.json`, `assets/`) | Add the dev dependencies, icons, a minimal preload and a CSP; add a CI build | 1 |

Smaller items from the audit, worth folding into the same pass: preset glide state is keyed by preset
rather than by track (tracks sharing a preset glide into each other); the 64-voice cap drops new notes
instead of stealing the oldest; channel strips start at default settings until the mix is first
applied, so an audition right after load ignores the fader; the reverb impulse is regenerated on every
slider tick; the arpeggiator cache never clears; and a number of dead functions remain in `audio.ts`,
`music.ts` and `sequencer.ts`.

### 2.2 Performance debt

None of this is visible on a normal machine today (§1), but each item scales with song size and will
matter once inserts, modulation and audio tracks add load.

| # | Item | Fix | Effort |
|---|---|---|---|
| P1 | Every store's context value is a new object on each render, so any change re-renders every consumer of all five stores. Arrangement scroll and zoom go through the global store. | Memoise context values; split rarely-changing state (view, scroll) into its own store or a ref-based subscription like the playhead | 1 |
| P2 | Lane canvases, the ruler and the piano roll redraw on unrelated renders; no vertical virtualisation of tracks. | Memoise drawing inputs, redraw only on change; virtualise lanes beyond ~20 tracks | 1–1.5 |
| P3 | The scheduler walks every clip and pattern note each 25 ms tick and allocates per tick. | Pre-index notes per pattern by start time; binary-search the window | 0.5 |
| P4 | Up to 23 audio nodes per note; each automated parameter writes up to 400 events per note. | Cap events by curve shape; share one LFO per track for vibrato; this is also the motivation for F18 | 1 |
| P5 | The export pipeline and the 152 KB preset table load up front. | Lazy-load the export dialog and pipeline; keep the preset list but split the specs | 0.5 |

**Phase 0 total (estimate at review time): about 12–13 days** for B1–B14 and P1–P5, or **6–7 days** for B1–B11 alone, which removes
everything a user can hit.

### 2.3 Status — all fixed

Every item above was fixed after this review. How each was checked:

| # | Fix | Verified by |
|---|---|---|
| B1 | Lab button reads the tab's playing flag; the duplicate flag is gone from the oscillator settings | e2e: PLAY → STOP → PLAY with measured tone |
| B2 | Compact transport below 1600 px, short view toggle below 1280 px, transport on its own scrollable row below 1024 px | e2e: one 39 px row at 1024 px; 95 px on a phone (was 259) with no page overflow |
| B3 | Note chase on play and seek; decayed one-shots aren't re-struck | unit tests (held notes, overlaps, clip ends); e2e: sound within 350 ms of starting mid-chord |
| B4 | Effects rack, channel strips and instrument/drum outputs are kept per audio context, so an export builds its own and leaves the live ones alone | e2e: live effect racks stay at 1 across WAV/MP3/stem/MIDI exports |
| B5 | AUDITION updates React only when the step changes; drum, FX, instrument and visualizer stores save debounced and skip transport/search state | e2e: at most 1 storage write in 1.5 s of AUDITION (was ~90) |
| B6 | One duck per kick; a window's events are sorted by the time they sound | unit test on event order |
| B7 | `Track.patch` (per-track instrument settings, editable from the library's new TRACK scope); project files carry the master effects and bake library edits into each track | unit tests: round trip of effects and patches; old files get default effects |
| B8 | One undo history across stores: song settings in every entry, drum patterns and effects via history participants | unit tests; e2e: drum step and tempo undo |
| B9 | Scheduler ticks from a Worker timer; lookahead widens when ticks run late; notes more than 50 ms overdue are dropped instead of bunched | Heaviest song at the Drop with the CPU throttled 4×: every note queued at least 74 ms ahead, none late (before: 3 within 5 ms, one 3 ms late). Same at 6× |
| B10 | Generation counter in both schedulers | — (race window is one `await`) |
| B11 | Drum AUDITION pauses while an export renders, skips missed steps, and is stopped by the export dialog | e2e export steps |
| B12 | Deleting a drum pattern also removes its clips, as one undo step | — |
| B13 | Orphaned note patterns are left out of the saved session; a full storage quota shows a notice once | unit test |
| B14 | Electron 44 and electron-builder in devDependencies, icon, preload, sandbox, CSP, navigation and permission guards; fixed an invalid NSIS option | packaged Linux build launched under Xvfb: loads from `file://`, CSP clean, plays, exports MP3 (`npm run test:electron`) |
| Smaller | Glide per track (chords glide together), voice stealing at the polyphony cap, strips start with the track's settings, debounced reverb impulse rebuild, arp cache keyed by identity (random mode no longer re-rolls each tick), dead code removed | unit tests + e2e |
| P1 | Store context values memoised | Scrolling the arrangement measured at 60 fps (p95 16.7 ms) even with the CPU throttled 4×, so scroll state stays in the store for now |
| P2 | Each lane redraws only when its own patterns change; ruler and piano roll redraw only on their own inputs | — |
| P3 | Notes indexed by start time per pattern, looked up by binary search | 300 randomised cases match the per-note search exactly |
| P4 | Automation written as one ramp per breakpoint (exponential for cutoff) instead of 8 samples per beat: a 32-beat note drops from 256 events to 4; pulse waves cached | unit tests: exact reproduction of the lane |
| P5 | Export dialog and pipeline load on first use | main bundle 494 → 472 KB (142 → 132 KB gzipped). The preset table stays in the main bundle: playback needs it at startup |
| Found later | **Instrument and drum sends bypassed the channel strip**: a preset's own reverb/delay/chorus went straight to the effects, so the fader, volume automation, mute and solo didn't touch them (a 20 dB volume-lane move changed the output by 1.7 dB). They now enter the strip through instrument-send inputs behind the same mute and fader, driven by one control source each | Offline render: the same 10× lane change now moves the output 21.7 dB; e2e: muting every track gives silence (was "under 10%") |

---

## 3. Feature candidates

Grouped by theme. Each says what it is, why it matters, where it plugs into the code, and how it would
be tested.

### Theme A — MIDI and composition

#### F1. Web MIDI input — play and record from a keyboard · Impact 5 · 4–6 days
**Why.** The single biggest workflow gap: today every note is drawn with the mouse or typed on the
computer keyboard (which only auditions, it doesn't record).
**What.** Pick an input in settings; the selected track plays live with velocity and sustain pedal;
a record-arm button on each track; recording writes notes into the clip under the playhead (or creates
one), with optional quantise-on-input and count-in. The computer-keyboard piano records too.
**Where.** `InstrumentEngine.playNote` takes a duration up front and schedules its own release, so it
needs splitting into `noteOn(...) → VoiceHandle` with `handle.release(time)`. The scheduled path keeps
working by calling both. Recording needs `armed` on `Track`, a song-beat → pattern-beat mapping (the
inverse of `occurrences` in `timeline.ts`), and a batch `SEQ_ADD_NOTES` action so one take is one undo
step.
**Risks.** Web MIDI is Chromium/Edge/Firefox (with permission); Safari has none — fall back to the
computer keyboard. Input latency must be compensated when writing note positions.
**Tests.** Unit: beat mapping with loops and clip offsets; e2e: a fake `navigator.requestMIDIAccess`
injected by the init script plays and records a phrase.

#### F2. Piano-roll composition aids · Impact 4 · 3–5 days
- **Key and scale**: a song key (stored in the project), scale rows highlighted, optional snap-to-scale
  when drawing and recording.
- **Chord tool**: stamp triads/sevenths/sus chords in the current key with one click; strum and
  inversion options.
- **Ghost notes**: other tracks' notes shown faintly behind the current pattern.
- **Velocity tools**: draw ramps, randomise (humanise), scale.
- **Quantise**: strength (%), note ends as well as starts, swing amount for note clips (today swing
  exists only on drum patterns).
- **Legato / fixed length / transpose selection by octave.**

All are reducer actions on a pattern plus drawing in `PianoRoll.tsx`; no engine changes. Each action is
pure and unit-testable.

#### F3. MIDI file import · Impact 4 · 2 days
The app exports MIDI but can't read it. Parse Standard MIDI Files (type 0 and 1): one track per MIDI
track/channel, channel 10 → a drum track with notes mapped to drum voices, tempo from the first tempo
event, instruments chosen with the existing `guessPresetForNotes`. Opens as a project or drops into the
current one. Tested by round-tripping the app's own MIDI export.

#### F4. Tempo and time-signature changes · Impact 3 · 5–7 days
A tempo lane (ramps and steps) and meter changes at section boundaries. Every beat↔time conversion
assumes one BPM (scheduler clock, playhead, export, MIDI export, delay sync), so this touches the timing
core; the pure `timeline.ts` design makes it testable but it is the riskiest item in this theme. Worth
doing after F1–F3, not before.

### Theme B — Sound design and mixing

#### F5. Per-track insert effects · Impact 5 · 8–12 days
**Why.** Today every track gets the same fixed strip (3-band EQ, gain, pan) and shares three master send
effects. Inserts are how producers shape individual sounds.
**What.** A chain per track, drag to reorder, bypass per unit. First set: compressor, saturator/drive,
multimode filter, bitcrusher, 8-band EQ, chorus/phaser, and per-track delay and reverb. Every parameter
automatable.
**Where.** Splice `inserts[]` into the strip between `eqHigh` and the fader (`channelStrip.ts`); add the
field to `Track`, a normaliser, and insert add/remove/move/set actions. Define an effect interface:
`create(ctx)`, `params`, `flush()` (for hard stop), `dispose()`, `tailSeconds`, `serialize()`. Every
instance must be rebuilt when the context swaps for export — so B4's `dispose()` is a prerequisite.
`AutomationTarget` is a closed list today; it becomes a structured id (`{ unit, param }`) so insert
parameters can have lanes.
**Tests.** Offline render of a test tone through each unit with known settings (e.g. compressor gain
reduction at a given threshold), round-trip through project files, automation of one insert parameter.

#### F6. Return tracks, buses and sidechain routing · Impact 4 · 5–7 days (after F5)
User-created return tracks with their own insert chains replace the three hard-wired sends; group buses
let a drum kit or a vocal stack share processing; sidechain chooses its source track instead of "any
kick". Sends are hard-coded in three places (channel settings, preset voice sends, drum sends), which
become `sends: Record<returnId, level>`.

#### F7. Master metering · Impact 3 · 2 days
LUFS momentary/short-term/integrated and true-peak on the master, in an AudioWorklet (the BS.1770
filter code already exists for export normalisation). Shows how loud the song is before exporting.

#### F8. Synth 2.0 — per-track patches and modulation · Impact 4 · 8–12 days
- **Per-track patches** (from B7): a track owns its instrument settings, so the same preset can be
  bright on one track and dark on another.
- **Modulation**: two LFOs (synced or free) and a modulation envelope per patch, routable to pitch,
  cutoff, resonance, amp, pan and drive, with depth per route.
- **Unison**: voice count, detune and stereo spread.
- **Voice handling**: steal the oldest voice instead of dropping, glide per track and per voice.
- **New oscillator types**: FM (2-operator) and a small wavetable set built from `PeriodicWave`s.

`playNote` builds each voice from local variables today. It needs a per-voice parameter map so
modulation sources (oscillators and `ConstantSourceNode`s) can connect to it.

### Theme C — The oscillator lab

The lab is where the app started and what makes it different from other browser DAWs. It's currently
a tone generator with a scope; these turn it into a sound-design tool whose results feed the arrangement.

#### F9. Lab upgrades · Impact 3–4 · 4–6 days
- **Draw your own waveform**: draw one cycle, or set up to 32 harmonic levels and phases (additive);
  either becomes a `PeriodicWave`. A lab tab used as a track's sound then plays that waveform.
- **More views**: a spectrum next to the scope, and an X–Y (Lissajous) mode for two tabs.
- **Musical frequency**: enter a note name (A4, C#3) as well as Hz; a tuner readout; fine-tune in cents.
- **Play it**: the lab tab responds to the computer keyboard and MIDI (via F1), with a simple envelope.
- **Modulate**: one lab tab can frequency- or amplitude-modulate another (FM/AM/ring), visible on the scope.
- **Fix B1** and add a lab e2e test (there is none for playback today).

### Theme D — Audio

#### F10. Audio clips and a sampler · Impact 5 · 12–18 days
**This is a change of direction**: the app is "everything synthesized, no samples" today. It is also the
largest step toward a full DAW, and a prerequisite for F11–F13.
- **Audio tracks**: drag WAV/MP3/OGG/FLAC onto the arrangement; clips with trim, fades, gain and
  (later) time-stretch; waveform display.
- **Sampler instrument**: one-shot or multi-zone samples played from the piano roll.
- **Storage**: audio in IndexedDB / OPFS, project files become a zip (`fflate` is already bundled).

**Where.** A new `audio` track source and an explicit clip payload (today `Clip.patternId` means two
different things), a new timeline event kind, a branch in `emitEvent`, buffer sources registered in the
voice pool so the hard stop works, and mid-clip start (which also needs B3's note chase).

#### F11. Audio input recording · Impact 4 · 5–8 days (after F10)
Record from a microphone or interface into an audio track, with input monitoring, latency compensation
and count-in. Builds on the existing lossless worklet tap.

#### F12. Freeze and bounce · Impact 3 · 3–4 days (after F10)
Render a track (or a selection) to an audio clip using the existing offline renderer. Frees CPU on big
songs and is how people commit to a sound.

#### F13. Audio to instrument
Already planned in [`audio-to-instrument.md`](audio-to-instrument.md) (3–5 weeks). It shares the audio
import, decoding and clip UI with F10, so it should come after F10.

### Theme E — Platform and workflow

| # | Feature | Impact | Effort | Notes |
|---|---|---|---|---|
| F14 | **Project library** in IndexedDB: many projects, autosaved versions, templates, recover after a crash | 4 | 3–5 | Replaces the single localStorage session (fixes B13 properly) |
| F15 | **PWA**: install, works offline | 2–3 | 1–2 | Everything is synthesized, so the app is already offline-capable |
| F16 | **Tablet and touch**: pointer events throughout, larger targets, a compact layout | 3 | 6–10 | All canvases use mouse events today |
| F17 | **Accessibility**: keyboard-operable arrangement and piano roll, labelled canvases, screen-reader announcements for transport and edits | 3 | 4–6 | 7 of 8 canvases have no label; 4 controls unlabeled |
| F18 | **AudioWorklet synth engine**: render voices in a worklet instead of building ~13–23 nodes per note | 4 | 15–25 | Big CPU headroom for unison, modulation and long songs; high risk — do only if F5/F8 hit CPU limits |
| F19 | **Sharing and collaboration**: share a read-only link; later, real-time co-editing (CRDT, e.g. Yjs) | 3 | 3 / 20+ | Needs a server for anything beyond a file link |
| F20 | **Command palette and rebindable shortcuts** | 2 | 2 | Quality of life once the feature count grows |

---

## 4. Ranking

Value is impact ÷ effort, adjusted for what each item unlocks.

| Rank | Item | Impact | Days | Why here |
|---|---|---|---|---|
| 1 | Phase 0: B1–B11 | — | 6–7 | Removes everything a user can hit; B4, B7 and B9 are foundations for later items |
| 2 | F1 Web MIDI input + recording | 5 | 4–6 | Biggest workflow gap |
| 3 | F2 Composition aids | 4 | 3–5 | Cheap, no engine risk, used on every song |
| 4 | F3 MIDI import | 4 | 2 | Completes the MIDI story with F1 |
| 5 | F5 Insert effects | 5 | 8–12 | Biggest sound-quality gap; unlocks F6 |
| 6 | F9 Oscillator lab upgrades | 3–4 | 4–6 | Distinctive; reuses F1 |
| 7 | F14 Project library | 4 | 3–5 | Safety of users' work |
| 8 | F8 Synth 2.0 | 4 | 8–12 | Needs B7; benefits from F5's parameter model |
| 9 | F7 Master metering | 3 | 2 | Small, useful before export |
| 10 | F6 Returns, buses, sidechain routing | 4 | 5–7 | After F5 |
| 11 | F10 Audio clips + sampler | 5 | 12–18 | Highest ceiling, but a change of direction — needs a decision |
| 12 | F4 Tempo/meter changes | 3 | 5–7 | Riskiest timing change; wait until the rest is stable |
| — | F11, F12, F13, F15–F20 | | | Follow the items they depend on |

---

## 5. Proposed roadmap

```
Phase 0  Stabilise          B1–B11 (+ B12–B14, P1–P5 if time)  ~1.5–2.5 weeks
Phase 1  "MIDI release"     F1 Web MIDI · F2 composition aids · F3 MIDI import · F7 metering
                            · F9 lab upgrades                   ~3–4 weeks
Phase 2  "Mix release"      B7 per-track patches · F5 inserts · F6 returns/buses · F8 synth 2.0
                            · F14 project library               ~5–7 weeks
Phase 3  "Audio release"    F10 audio clips + sampler · F12 freeze/bounce · F11 recording
                            · F13 audio-to-instrument           ~8–12 weeks
Phase 4  Platform           F15 PWA · F16 touch · F17 accessibility · F18 worklet engine
                            · F19 sharing · F4 tempo track      as needed
```

Each phase ends with the same bar as the releases so far: lint, unit tests for every pure function the
phase adds, an e2e step per user-facing feature that measures audio output where it can, the example
projects still passing, and the guide and README updated.

### Decisions for you

1. **Samples or not?** F10 ends the "no sample files" design. It is the biggest capability jump, but it
   changes what the app is. Everything before Phase 3 works either way.
2. **Target platform.** Desktop browser only, the Electron app as well (needs B14), or tablets too
   (F16 is 1–2 weeks on its own)?
3. **Project format.** B7 and F10 both change the project file. They should land in one format
   version (v3) with a migration, rather than two.
4. **Where to start.** The recommendation is Phase 0, then F1 + F2 + F3 together, since a MIDI keyboard
   plus scale and chord tools changes day-to-day use the most for the least risk.
