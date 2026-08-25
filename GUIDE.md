# OSC — Digital Oscillator Synthesizer · User Guide

OSC is a browser-based synthesizer and sequencer. You can play multiple oscillators simultaneously, visualize their waveforms in real time, compose note sequences in a piano roll editor, mix tracks, and record the output to a file.

---

## Interface Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│ ≋ OSC   DIGITAL OSCILLATOR SYNTHESIZER      MASTER ▓▓░░  OVERLAY  SEQUENCER  ● PLAYING │
├─────────────────────────────────────────────────────────────────────┤
│ ● OSC 1  ● OSC 2  ● OSC 3                    + OSC                 │  ← Tab bar
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│                      OSCILLOSCOPE DISPLAY                           │  ← Waveform canvas
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│ [sine][sqr][saw][tri]  Frequency ──────●──── 440.0 Hz              │
│                        Amplitude ────●──────  0.80                 │  ← Controls
│  Phase ──●──  PW ──●──  Tab level ──●──   [▶ PLAY]                 │
│  ▾ Advanced                                                         │
├─────────────────────────────────────────────────────────────────────┤
│  ● REC 00:12   ↓ WebM   ↓ WAV                                       │  ← Recording bar
└─────────────────────────────────────────────────────────────────────┘
```

When the **Sequencer** is open, a panel is inserted between the tab bar and the oscilloscope:

```
├─────────────────────────────────────────────────────────────────────┤
│ ⏮ [▶ PLAY] ⏹  1:1 · 0:00.0  BPM [120]  /BAR [4]  SNAP [1/16]  ↻ LOOP │
│ TRACK  ● OSC 1  ● OSC 2          MIXER  ↓ SAVE  ↑ LOAD           │
│ ┌──────────┬───────────────────────────────────────────────────┐   │
│ │ OSC 1    │  Piano roll canvas (draw notes here)              │   │
│ │ M S pan  │                                                   │   │
│ └──────────┴───────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┤
```

---

## Oscillator Controls

### Waveform

Four buttons select the oscillator waveform:

| Button | Waveform | Sound character |
|--------|----------|-----------------|
| `sine` | Sine | Pure, smooth, flute-like |
| `sqr`  | Square | Hollow, nasal, clarinet-like |
| `saw`  | Sawtooth | Bright, buzzy, string/brass-like |
| `tri`  | Triangle | Soft, mellow, between sine and square |

### Frequency

- Range: **20 Hz – 20 000 Hz**
- The slider is **logarithmic** so equal slider distances correspond to equal musical intervals (octaves)
- Type a frequency directly into the numeric input on the right and press Enter or Tab to commit; press Escape to cancel

### Amplitude

Controls how loud this oscillator is. Range **0.0 – 1.0**.

### Phase

Shifts the starting point of the waveform. Audible only when two oscillators play the same frequency — shifting one by 180° (π radians) causes them to partially cancel. Range **0° – 360°**.

### Pulse Width

Only active when the **square** waveform is selected. Controls the duty cycle — the fraction of each cycle that is high vs. low. At **50%** you get a standard square wave. At **10%** or **90%** the wave becomes thin and nasal. Range **1% – 99%**.

### Tab Level

Per-oscillator volume, independent of Master Volume. Use this to balance oscillators relative to each other. Range **0 – 100%**.

### Play / Stop

Starts or stops audio output for the **active tab** only. Each tab has its own independent play state.

### Advanced Panel

Click **▾ Advanced** to expand:

| Control | What it does |
|---------|--------------|
| **Detune** | Shifts pitch up or down in cents (1/100 of a semitone). Range ±100¢. Useful for chorus/thickening effects when layering two oscillators |
| **Zoom (cycles)** | How many waveform cycles are visible in the oscilloscope. Higher = zoomed out, useful for seeing periodic structure at high frequencies |
| **Line thickness** | Oscilloscope waveform line width in pixels (1–4) |
| **Color theme** | Changes the accent color for this tab's oscilloscope and controls: Green, Amber, Blue, or White |
| **Show grid** | Toggle the amplitude grid lines and timing ruler in the oscilloscope |

---

## The Oscilloscope

The large canvas in the middle of the screen renders a real-time waveform display at 60 fps. The horizontal axis is time (labeled in milliseconds or microseconds); the vertical axis is amplitude (−1.0 to +1.0).

### Single mode (default)

Shows only the active tab's waveform, rendered in the tab's accent color. Amplitude grid lines and timing labels are drawn when **Show grid** is on.

### Overlay mode

Click **OVERLAY** in the header to switch. All oscillators are drawn simultaneously:

- Each oscillator renders in its tab color at 60% opacity (100% if it is the active tab)
- Muted oscillators render at 18% opacity
- A **white SUM** waveform is drawn on top, showing the mixed output clipped to ±1.0
- A legend in the top-right corner identifies each tab by color and label

To return to single mode, click **OVERLAY** again.

---

## Working with Multiple Oscillators

### Adding an oscillator

Click **+ OSC** at the right end of the tab bar. A new tab appears with default settings (sine wave, 440 Hz). The sequencer automatically gains a matching track.

### Renaming a tab

**Double-click** the tab label to edit it inline. Press Enter or click elsewhere to confirm; press Escape to cancel.

### Reordering tabs

**Drag** a tab left or right to reorder it.

### Removing a tab

Click the **×** button on a tab. The tab must not be the last one (minimum one oscillator). Its sequencer track and all notes are removed.

### Mute and Solo

Each tab has **M** (mute) and **S** (solo) indicators visible in the tab bar:

- **Mute (M)**: silences this oscillator. Shown in yellow when active. Other oscillators are unaffected.
- **Solo (S)**: silences all *other* oscillators. Only one tab can be soloed at a time. Shown in the tab's accent color when active.

Mute and Solo can also be toggled from the Waveform/Controls panel and from the Mixer.

### Balancing levels

Use **Tab level** (in the Controls panel) or the **volume fader** in the Mixer to set each oscillator's relative level. The **Master Volume** slider in the header applies to the combined output of all oscillators.

---

## The Sequencer

Click **SEQUENCER** in the header to open the sequencer panel. Click again to close it. The sequencer panel shrinks the oscilloscope but does not stop audio playback.

The sequencer contains:
- **Transport bar** — play/stop/BPM/loop controls
- **Track toolbar** — switch between tracks, open Mixer, save/load project
- **Piano Roll** — canvas-based note editor for the selected track

---

## Piano Roll Editor

### Drawing your first note

1. Open the sequencer and click **▶ PLAY** — or keep it stopped while you compose
2. Make sure **✎ DRAW** mode is selected in the transport bar
3. Click anywhere on the piano roll grid (right of the piano keys, below the ruler) to place a note
4. The note is created at the pitch corresponding to the row you clicked and snapped to the current grid
5. Drag left/right while holding the mouse button to resize the note before releasing

### Selecting notes

Switch to **⊹ SELECT** mode in the transport bar.

- Click a note to select it
- Shift-click to add/remove from the selection
- Click-drag on empty space to draw a **selection box** — all notes touched by the box are selected

### Moving notes

In either mode, **click and drag** the body of an existing note to move it. The note snaps to the grid while dragging.

### Resizing notes

Drag the **right edge** of a note (within 8 pixels of the right side) to resize it. The minimum duration is 1/16 beat.

### Deleting notes

- **Draw mode**: right-click a note to delete it immediately
- **Select mode**: select notes and press **Delete** or **Backspace**

### Note velocity

Notes are created at the default velocity (100/127). Velocity controls how loudly each note plays. It is shown as note opacity — darker notes are quieter.

**Editing velocity:** click **VEL** in the transport bar to reveal the velocity lane below the piano roll. Each note appears as a vertical bar; drag a bar up or down to raise or lower velocity. Selected notes are shown in white. Click **VEL** again to hide the lane.

### Snap-to-grid

The **SNAP** selector in the transport bar controls the grid resolution:

| Value | Duration |
|-------|----------|
| 1/1   | Whole note (4 beats) |
| 1/2   | Half note (2 beats) |
| 1/4   | Quarter note (1 beat) |
| 1/8   | Eighth note (½ beat) |
| 1/16  | Sixteenth note (¼ beat) — default |
| 1/32  | Thirty-second note (⅛ beat) |

Snap applies to note placement and movement. Hold **Shift** during drag to move freely without snapping (fine adjustment).

### Undo / Redo

- **Ctrl+Z** (or **⌘Z** on Mac): undo last note operation
- **Ctrl+Shift+Z** (or **⌘Shift+Z**): redo
- The ↩ and ↪ buttons in the transport bar do the same
- Up to 50 undo levels are kept

### Scrolling and zooming

On the piano roll canvas:

| Gesture | Action |
|---------|--------|
| Scroll wheel (up/down) | Scroll horizontally through time |
| Shift + scroll | Scroll vertically through pitch range |
| Ctrl + scroll (or ⌘ + scroll) | Zoom in/out horizontally |

---

## Transport Controls

### Play / Stop

The **▶ PLAY** / **■ STOP** button starts and stops sequencer playback. This is separate from the per-tab Play buttons in the oscillator controls — the sequencer plays its own scheduled notes through its own audio nodes.

### Stop and Reset (⏹)

Stops playback and returns the playhead to the loop start (if looping is on) or beat 0.

### Rewind (⏮)

Returns the playhead to beat 0 and stops if playing.

### BPM

Type a value between 20 and 300. Changes take effect immediately, even during playback.

### Time signature (/BAR)

Sets how many beats are in one bar (affects the ruler and bar-line display). Options: 2, 3, 4, 6, 8.

### Loop (↻ LOOP)

When enabled, playback loops between **loopStartBeat** (0 by default) and **loopEndBeat** (16 beats by default). The loop region is shown as a colored overlay in the piano roll.

### Song Length (BARS)

Sets the total song length in bars (1–128). Used for display and for determining the loop end when no custom loop region is set. Actual scheduling is not capped — notes beyond the song length will still play.

### NOTE length

Sets the duration of **newly drawn notes**. Same grid options as SNAP (1/1 – 1/32). Changing NOTE length does not affect existing notes.

### VEL (velocity lane)

Toggles the 50 px velocity lane below the piano roll. See [Note velocity](#note-velocity).

### Q (quantize)

Snaps all **selected** notes to the nearest SNAP grid line. Equivalent to pressing the **Q** key. Disabled when nothing is selected.

---

## The Mixer

Click **MIXER** in the sequencer toolbar to reveal the mixer panel below the piano roll.

The mixer has one column per oscillator tab plus a **MASTER** strip on the left.

Each channel strip contains:
- **Label** and **color dot** identifying the oscillator
- **VU meters** (two bars) showing the current output level from green through amber to red
- **Volume fader** — drag vertically to set this tab's level (same as Tab Level in the controls panel)
- **Pan slider** — drag left/right, shows `L50`, `C`, `R50`, etc.
- **M** / **S** — mute and solo buttons

The **MASTER** strip controls the global output volume (same as the Master slider in the header).

> Note: VU meters tap the master output and show the blended signal — all channels show the same level reading, reflecting the overall mix.

---

## The Drum Machine

Click **DRUMS** in the header to open the drum panel. (Drum voices feed the master FX rack —
see **Master Effects** below for the room they sit in.) Every sound is synthesized live by the
Web Audio API — there are no sample files, so nothing to download and nothing to go missing.

### Playing a pattern

1. Pick a pattern from the dropdown — patterns are grouped by genre (Rock, Hip-Hop,
   Electronic, Funk, Jazz, Latin, World)
2. Press **▶ PLAY**
3. Leave **SYNC** lit to follow the sequencer's BPM, or turn it off and set an independent tempo

The drum machine loops its pattern independently of the sequencer's transport, so you can
audition a beat while writing notes in the piano roll.

### The step grid

Each row is one drum voice; each square is one 16th note. Squares are grouped in fours with a
small gap so downbeats are easy to find. Click a square to switch that hit on or off. During
playback the current step is highlighted in white.

Dimmer active squares are *ghost notes* — hits with a low velocity, used in Funk, Boom Bap
and Amen Break patterns to imply a shuffle without adding accents.

### Voice groups

With 33 voices the full list is long, so the **VOICES** row filters it:

| Filter | Shows |
|--------|-------|
| **ALL** | every voice |
| **KIT** | kicks, snares, hi-hats, clap, rim, snap, toms |
| **CYMBAL** | crash, splash, ride, ride bell, reverse cymbal |
| **PERC** | cowbell, shaker, cabasa, tambourine, congas, bongo, timbale, woodblock, clave, triangle |
| **FX** | zap, sub drop |

Filtering only hides rows — hidden voices still play.

### Editing individual hits

**Right-click an active step** to open its parameter popup:

| Parameter | Range | Effect |
|-----------|-------|--------|
| **VEL** | 1–127 | Loudness of this one hit |
| **PITCH** | −12 to +12 | Transposes this hit in semitones |
| **DECAY** | 0.2–2.0 | Multiplies this hit's tail length |

These stack on top of the voice-level settings, so a step at pitch +3 on a voice already
tuned to −2 sounds one semitone up.

### Editing a whole voice

**Right-click a voice name** for the row's settings:

| Parameter | Effect |
|-----------|--------|
| **VOL** | Level of every hit in the row |
| **PAN** | Stereo position |
| **TONE** | Brightness — moves the filter cutoff on noise-based voices, adds bite on tonal ones |
| **PITCH** | Base tuning in semitones |
| **DECAY** | Base tail length |
| **CLEAR ROW** | Removes every hit in the row |

**Left-click a voice name** to audition it with its current settings.

### Pattern management

| Button | Action |
|--------|--------|
| **16 / 32** | Switch step count; existing steps are preserved, new steps start empty |
| **SWING** | Delays every off-beat 16th, 0–50% |
| **+** | New empty pattern |
| **⧉** | Duplicate the current pattern |
| **🗑** | Delete the current pattern (the last one can't be deleted) |
| **CLR** | Clear all steps in the current pattern |

Patterns are saved to `localStorage` automatically. Factory patterns you edit stay edited; if a
future version adds new voices or presets, your patterns are migrated rather than reset.

---

## The Instrument Library

Click **INSTRUMENTS** in the header. This is a library of 161 synthesized instruments across
eighteen categories:

| Group | Categories |
|-------|-----------|
| Keyboards | Piano, Keys, Organ |
| Synths | Synth Lead, Synth Pad, Synth Bass, Synth Pluck |
| Guitars | Electric Guitar, Acoustic Guitar, Bass Guitar |
| Orchestral | Strings, Brass, Woodwind |
| Tuned percussion | Mallets, Plucked |
| Other | Vocal, World, FX |

Everything is synthesized live — there are no sample files, so the whole library costs nothing
to load and works offline.

### Browsing and auditioning

Filter with the **category dropdown** or type into the **search** box (matches name and
category). **Click any card** to hear a short phrase appropriate to its type — a chord for
pads, a strum for guitars, a riff for leads, a bass line for basses.

A small dot on a card means you've customized that preset's parameters.

### Assigning an instrument to a track

1. Choose the target track in the **ASSIGN TO** dropdown (top-right)
2. Hover a preset card and click **SET**

The track appears in the **ACTIVE** bar. From that point, when the sequencer plays that track's
notes it builds a fresh instrument voice per note instead of using the track's raw oscillator —
so you get real envelopes, filters, and polyphony rather than a single sliding tone.

Click the **×** next to an assignment to return that track to its plain oscillator.

> The track's own **Amplitude** still scales the instrument, and the mixer's **Pan** still
> applies, so the mixer keeps working exactly as before.

### Editing instrument parameters

**Right-click a preset card** to open its editor:

| Parameter | Effect |
|-----------|--------|
| **VOLUME** | Output level |
| **PAN** | Stereo position (overridden by track pan when assigned) |
| **ATTACK** | Time to reach full volume — near zero for plucks, up to seconds for pads |
| **DECAY** | Time to fall from peak to the sustain level |
| **SUSTAIN** | Level held while the note lasts; 0 makes any preset behave like a pluck |
| **RELEASE** | Tail length after the note ends |
| **CUTOFF** | Filter frequency — the single biggest tone control |
| **RESO** | Filter resonance; high values give the whistling acid character |
| **DRIVE** | Waveshaper distortion, 0 = clean through to hard clipping |
| **DETUNE** | Extra cents spread across the oscillator stack — adds width and chorus |
| **OCTAVE** | Transposes ±2 octaves |
| **GLIDE** | Portamento time between notes |
| **WIDTH** | Spreads the oscillator stack across the stereo field |
| **REVERB / DELAY / CHORUS** | How much of this instrument is sent to each master effect |

Parameters are grouped into **TONE**, **ENVELOPE** and **MIX**. Changes apply immediately and
persist across reloads. **RESET** restores the factory settings for that preset.
**▶ AUDITION** at the bottom of the editor replays the preview so you can hear your edits.

### Why the instruments respond to how hard you play

Two things happen automatically and are worth knowing about when you write velocities in the
piano roll:

- **Velocity opens the filter.** A note at velocity 120 is not just louder than one at 60 —
  it is brighter, and its pick attack bites harder. This is why writing dynamics into a part
  makes it sound played rather than programmed.
- **Acoustic presets are humanized.** Pianos, guitars, strings and winds get a small random
  tuning and level variation per note, so a repeated note never comes out bit-identical.
  Synth presets have this at zero, because a synth *should* be exact.

### Layering

To stack sounds, put the same notes on two tracks and assign a different instrument to each —
for example *Acoustic Guitar → Steel String* on one and *Synth Pad → Warm Pad* on another,
then use the mixer to balance and pan them apart. Add the drum machine on top and you have a
full arrangement.

---

## Master Effects

Click **FX** in the header. These are **send** effects: instead of each sound carrying its own
reverb, every instrument and drum voice feeds one shared rack. That is how records are mixed,
and it is why a piano and a guitar sitting in the same reverb sound like they are in the same
room rather than two different ones.

Each rack's **name** is a power button — click it to bypass that effect entirely.

### Reverb

| Control | Effect |
|---------|--------|
| **SIZE** | Tail length, 0.2–8 seconds. Small values read as a room, large ones as a hall |
| **DAMP** | How quickly high frequencies die away. Low = bright and glassy, high = dark and soft |
| **RETURN** | Overall level of the reverb coming back into the mix |

The impulse response is generated from scratch whenever SIZE or DAMP changes, so there is a
brief moment of computation when you move those two — the rest are instant.

### Delay

| Control | Effect |
|---------|--------|
| **TIME** | Click **SYNC** / **FREE** to toggle. Synced picks a note division (1/4 down to 1/16, plus dotted `1/8.` and triplet `1/8T`) and follows the sequencer BPM; free is 20–1200 ms |
| **FEEDBACK** | How much each repeat feeds the next. Above about 70% it starts to build |
| **RETURN** | Level of the repeats |
| **PING-PONG** | Repeats alternate left and right instead of staying centred |

Repeats run through a low-pass filter, so each one is darker than the last and they sit behind
the dry signal rather than competing with it.

### Chorus

Two short modulated delay lines panned hard apart. **RATE** sets the drift speed, **DEPTH** how
far it drifts, **RETURN** the level. Small amounts widen a sound; large amounts detune it
audibly. Rhodes, organs and pads have chorus sends set by default.

### Drum sends

Two levels controlling how much of the drum kit goes to reverb and delay. Kicks, the 808 kick,
the tight kick and the sub drop are **always dry** regardless of these — putting reverb on the
low end is the fastest way to make a mix muddy.

### Limiter

A compressor at a high ratio sitting on the master output, after the master volume and before
both the speakers and the recording tap. **CEILING** sets the threshold.

Leave this on. Once you have several instrument tracks, a drum pattern and three effect returns
summing together, peaks will exceed full scale and clip; the limiter catches them. Turn it off
only if you want to hear the raw sum.

---

## Recording Audio

### Starting a recording

1. **Play** at least one oscillator first (this creates the AudioContext)
2. Click the **● REC** button at the bottom of the window
3. The button turns red and pulses, showing elapsed time (MM:SS)

### Stopping and downloading

Click **● REC** again to stop. Two download buttons appear:

| Button | Format | When to use |
|--------|--------|-------------|
| **↓ WebM** | Compressed audio (Opus codec) | Smallest file, works in all modern browsers |
| **↓ WAV** | Uncompressed 16-bit PCM | Lossless, compatible with any audio editor |

WAV export decodes the compressed recording and re-encodes to PCM — this takes a moment for long recordings.

### Practical limits

- Recording length is limited only by available RAM. Each second at 48 kHz stereo in the compressed format is approximately 6–12 KB
- Very long recordings (> 30 minutes) may cause the WAV export to fail due to the large ArrayBuffer required for decoding — use WebM for archiving long sessions
- The recording captures the mixed output of all playing oscillators through the master gain

### Troubleshooting silence

- Recording captures whatever is playing through the Web Audio API. If no oscillator tab is active (playing), the recording will contain silence
- Start at least one oscillator before beginning the recording

---

## Saving and Loading Projects

The app automatically saves your full session (oscillators, sequencer, settings) to `localStorage` in the browser — your work persists across page reloads without any manual action.

Project files (`.oscproject`) let you share or archive specific compositions. They save the sequencer state but not oscillator tone settings (waveform, frequency, etc.).

### Saving

Click **↓ SAVE** in the sequencer toolbar. A file named `osc-project-<timestamp>.oscproject` is downloaded. This is a JSON file you can open in a text editor.

### Loading

Click **↑ LOAD** and select an `.oscproject` or `.json` file. The sequencer tracks are replaced with the loaded data. A warning is shown if the file version doesn't match or required fields are missing.

### What is saved

| Saved | Not saved |
|-------|-----------|
| BPM | Waveform type per oscillator |
| Time signature | Frequency, amplitude, phase |
| Song length | Pulse width |
| Notes per track | Advanced settings (detune, zoom, color) |
| Track pan | Mute/solo state |
| Master volume | Whether oscillators are currently playing |

---

## Keyboard Shortcuts

### Piano roll editing

| Shortcut | Action |
|----------|--------|
| **Ctrl+Z** | Undo |
| **Ctrl+Shift+Z** | Redo |
| **Delete** / **Backspace** | Delete selected notes |
| **Right-click** on note | Delete note (Draw mode) |
| **Ctrl+C** | Copy selected notes to clipboard |
| **Ctrl+V** | Paste notes at playhead position |
| **Ctrl+A** | Select all notes in the current track |
| **Escape** | Deselect all notes |
| **Q** | Quantize selected notes to the current snap grid |
| **Shift+click** | Toggle note in/out of selection |

### Piano roll navigation

| Shortcut | Action |
|----------|--------|
| **Ctrl+scroll** | Zoom in/out horizontally |
| **Shift+scroll** | Scroll vertically (pitch range) |
| **Scroll** | Scroll horizontally (time) |

### Computer keyboard piano

When the piano roll is visible, letter keys preview notes through the current tab's oscillator:

```
Key layout (home row = C4):
W  E     T  Y  U     O  P
A  S  D  F  G  H  J  K  L  ;
C4 D4 E4 F4 G4 A4 B4 C5 D5 E5
```

Hold multiple keys to play chords. The notes use the tab's waveform and amplitude settings.

### General

| Shortcut | Action |
|----------|--------|
| **Double-click tab label** | Rename tab |
| **Drag tab** | Reorder tabs |

---

## Troubleshooting

| Problem | Likely cause | Solution |
|---------|-------------|----------|
| No sound when clicking Play | Browser autoplay policy requires a user gesture | Click anywhere on the page first, then press Play |
| No sound from sequencer | No oscillator tab is playing | The sequencer uses its own audio nodes — sound plays regardless of tab play state. If still silent, check Master Volume |
| REC button does nothing | AudioContext not created yet | Click **▶ PLAY** on any oscillator tab first, then use REC |
| "Play at least one oscillator before recording" | Same as above | Same solution |
| Audio clicks on parameter change | Should not happen — all changes use smooth transitions | If you hear clicks, report the specific parameter being changed |
| Playhead drifts | Should not happen — scheduler uses AudioContext.currentTime | If drifting, stop and restart playback |
| Project file won't load | Version mismatch or corrupt file | Check the error message shown in the toolbar. Re-export from the version that created it |
| WAV download fails or is silent | Recording was empty, or file too large to decode | Ensure oscillators were playing during recording; use WebM for recordings longer than ~10 minutes |
| VU meters are dark | No audio playing | Start at least one oscillator; meters activate once audio flows |
| Browser zoom happens with Ctrl+scroll | Old browser without non-passive wheel support | Update browser to Chrome 98+ / Firefox 96+ / Edge 98+ |
