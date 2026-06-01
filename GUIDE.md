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

Notes are created with velocity 100 (of 127 maximum). Velocity controls how loudly each note plays in the sequencer. Higher velocity = brighter, louder note. Velocity is shown as opacity — darker notes are quieter. Direct velocity editing is not yet implemented; notes use the default 100.

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

Project files save the sequencer state — note data, BPM, time signature, track pan settings, and master volume. They do **not** save oscillator waveform/frequency settings (these are session-only).

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

| Shortcut | Action |
|----------|--------|
| **Ctrl+Z** | Undo (piano roll) |
| **Ctrl+Shift+Z** | Redo (piano roll) |
| **Delete** / **Backspace** | Delete selected notes |
| **Right-click** on note | Delete note (Draw mode) |
| **Shift+click** | Add/remove note from selection |
| **Ctrl+scroll** | Zoom piano roll in/out |
| **Shift+scroll** | Scroll piano roll vertically (pitch) |
| **Scroll** | Scroll piano roll horizontally (time) |
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
