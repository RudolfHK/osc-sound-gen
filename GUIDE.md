# OSC · User Guide

OSC is a browser-based music production app: an arrangement of tracks and clips, a piano roll and
drum step sequencer, 161 synthesized instruments, a mixer with per-track EQ, sends and sidechain,
master effects, automation, and an optional oscillator lab for hands-on waveform synthesis.

Everything is synthesized in real time by the Web Audio API — there are no sample files.

1. [Interface Overview](#interface-overview)
2. [Your First Song](#your-first-song)
3. [The Arrangement](#the-arrangement)
4. [The Editor](#the-editor)
5. [Transport](#transport)
6. [The Drum Machine](#the-drum-machine)
7. [The Instrument Library](#the-instrument-library)
8. [The Mixer](#the-mixer)
9. [Master Effects](#master-effects)
10. [Automation](#automation)
11. [The Arpeggiator](#the-arpeggiator)
12. [The Oscillator Lab](#the-oscillator-lab)
13. [The Visualizer](#the-visualizer)
14. [Recording](#recording)
15. [Projects and Saving](#projects-and-saving)
16. [Keyboard Shortcuts](#keyboard-shortcuts)
17. [Troubleshooting](#troubleshooting)

---

## Interface Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ OSC ▾  Project name   ⏮ ▶PLAY ⏹ ●REC  1.1.1 0:00.0  BPM 120  4/4  ↻LOOP  ♩CLICK │
│                                     MASTER ▓▓░  [ARRANGE|OSC LAB]  VIZ  ●       │
├──────────────────────────────────────────────────────────────────────────────┤
│ ARRANGE  + Instrument  + Drums  + Oscillator   GRID Bar  − + FIT  LENGTH 16      │
├────────────────┬─────────────────────────────────────────────────────────────┤
│ SECTIONS       │ Intro ▕ Verse ▕ Drop ▕ …                       ← sections    │
│ BARS · LOOP    │ 1    2    3    4    5    6   ════loop════        ← ruler       │
├────────────────┼─────────────────────────────────────────────────────────────┤
│ Drums   M S    │ ▕House▕▕House▕                                  ← clips       │
│ Bass    M S A  │      ▕Bass 1      ▕                                           │
│  └ automation  │ ───╱──────╲─────                                ← lane (A)    │
│ Keys    M S A  │ ▕Keys 1▕                                                       │
├────────────────┴─────────────────────────────────────────────────────────────┤
│ EDITOR │ MIXER │ INSTRUMENTS │ FX                               ← dock tabs   │
│ ┌ pattern / arp ┬ piano roll (or drum step sequencer) ──────────────────────┐ │
└──────────────────────────────────────────────────────────────────────────────┘
```

The layout follows the arrange-above / editor-below split used by Ableton Live, Logic and Bitwig:

- **Header** — file menu (**OSC ▾**), project name, transport, master volume, view switch, visualizer
- **Arrangement** — tracks down the left, the song left to right, sections and loop on the ruler
- **Dock** — the editor for whatever clip is selected, plus the mixer, instrument library and effects.
  Drag its top edge to resize it; click the open tab to collapse it

**OSC LAB** swaps the arrangement for the oscillator lab. It's optional: nothing in a song depends on it.

---

## Your First Song

1. **Open an example** — **OSC ▾ → Open example → midnight drive** — and press **Space** to hear what
   the app can do. Or keep the starter project: Drums, Bass, Keys and Pad tracks.
2. **Make a beat** — double-click the Drums lane at bar 1. A drum clip appears and the dock shows the
   step sequencer. Pick a pattern from the dropdown, or click steps to write your own.
3. **Write a bass line** — double-click the Bass lane. Draw notes in the piano roll below.
4. **Extend it** — drag the right edge of a clip; its pattern repeats to fill it.
5. **Add sections** — double-click the SECTIONS row at bar 9 to start a "Verse". Right-click a section
   to loop it, duplicate it (with everything in it), or delete it.
6. **Mix** — open the **MIXER** tab. Turn up **SC** (sidechain) on the bass so it ducks under the kick.
7. **Save** — Ctrl+S downloads a `.oscproject` file. Your session is also kept automatically.

---

## The Arrangement

### Tracks

Each track has a **sound source**, shown under its name:

| Source | Plays | Add with |
|--------|-------|----------|
| **Instrument** | One of the 161 presets in the instrument library | **+ Instrument** |
| **Drum kit** | Drum patterns from the step sequencer | **+ Drums** |
| **Oscillator** | A waveform from the OSC LAB (optional) | **+ Oscillator**, or ⋯ → *Use an oscillator* |

Track header controls:

| Control | Action |
|---------|--------|
| Name | Double-click to rename |
| Sound name | Click to choose a different instrument (or open the drum editor) |
| Slider | Track volume (same as the mixer fader) |
| **M** / **S** | Mute / solo. Solos add up — solo two tracks to hear both |
| **A** | Show the track's automation row |
| **⋯** or right-click | Change sound, colour, duplicate, move up/down, delete |

Mute works like a hardware mute: it silences notes that are already ringing, and un-muting brings a
held pad straight back.

### Clips

Clips are regions on a track's lane. Each one plays a **pattern** of notes (or a drum pattern).

| To… | Do this |
|-----|---------|
| Create a clip | Double-click an empty spot on a lane |
| Edit it | Click it — the dock's EDITOR shows its pattern. Double-click opens the editor if it's closed |
| Move it | Drag it — also onto another track of the same kind |
| Copy it | **Alt**-drag, or **Ctrl+D** to duplicate it right after itself |
| Loop it | Drag the right edge past the pattern's length — the pattern repeats (dashed lines mark each repeat) |
| Trim the start | Drag the left edge — the clip starts later in its pattern |
| Split it | **Ctrl+E** splits at the playhead; or right-click → Split |
| Mute it | Right-click → Mute clip |
| Delete it | **Delete**, or right-click → Delete |

Edges and positions snap to the **GRID** (bar, beat, 1/8 or 1/16). Hold **Shift** while dragging to
ignore it.

### Linked clips

**Duplicate** makes an independent copy, as in Ableton and Logic — edit it without touching the
original. **Duplicate as linked** (right-click) shares the pattern instead: both clips change when you
edit either one. Linked clips show **⧉** before their name; **Make unique** splits one off.

### Sections

The top row of the ruler holds the song's **sections** — Intro, Verse, Build, Drop and so on. Each
section runs from its marker to the next one.

| To… | Do this |
|-----|---------|
| Add a section | Double-click the sections row where it should start |
| Rename | Double-click the section's name |
| Move its start | Drag it |
| Jump there | Click it |

Right-click a section for:

- **Loop this section** — sets the loop to exactly that section, for working on one part
- **Duplicate section** — copies every clip and automation point in it to straight after it and
  pushes the rest of the song along. This is how you go from one chorus to two
- **Delete section and its content** — removes the clips that start in it and closes the gap
- **Remove marker only** — merges it into the previous section without touching any clips
- **Split section at this bar**, **Colour**, **Rename**

### The bar ruler and loop

- **Click** the bar ruler to move the playhead (it restarts from there if playing)
- **Drag** across it to set the loop range and turn looping on
- **Drag** the loop's edges to adjust it; **L** toggles looping
- If you start playback *after* the loop's end, it plays straight through — the loop only engages
  when the playhead reaches it

### Navigating

| Gesture | Action |
|---------|--------|
| Wheel | Scroll tracks up and down |
| Shift+wheel, or the scrollbar | Scroll through time |
| Ctrl+wheel | Zoom around the mouse |
| **FIT** | Show the whole song |
| **LENGTH** | Song length in bars (grows automatically when you place clips further out) |

---

## The Editor

Select a clip and the **EDITOR** tab shows it: the piano roll for instrument tracks, the drum step
sequencer for drum tracks.

### The pattern column

On the left: the track, the **pattern name**, its **LOOP** length, how many notes it has, whether
it's linked to other clips, **CLEAR NOTES**, and the track's **arpeggiator**.

The pattern's loop length is also the bright bar along the piano roll's ruler — drag its handle to
change it. Notes beyond it are dimmed and don't play. Drawing a note past the end extends the loop
to the next bar.

### Drawing notes

In **✎ DRAW** mode (the default):

- **Click** an empty cell to add a note of the **NOTE** length; drag right while still holding to
  stretch it
- **Drag** a note to move it in time and pitch; drag its right edge to resize it
- **Right-click** a note to delete it
- Hold **Alt** while clicking to place a note off the grid

Every note you draw or drag plays through the track's actual instrument, so you hear what you're
writing. Click the piano keys on the left to audition a pitch.

### Selecting

In **⬚ SELECT** mode, drag a box to select notes; **Shift+click** adds or removes one. In either
mode, **Ctrl+A** selects all. Dragging a selected note moves the whole selection.

With notes selected:

| Key | Action |
|-----|--------|
| **↑** / **↓** | Transpose a semitone (Shift: an octave) |
| **Q** | Quantize to the grid |
| **Ctrl+C** / **Ctrl+V** | Copy, then paste right after the selection |
| **Delete** | Delete |
| **Escape** | Deselect |

### Velocity

Toggle **VEL** for a velocity lane under the notes and drag a bar up or down. Velocity changes tone as
well as level — see *Why the instruments respond to how hard you play* below.

### Grid and zoom

**GRID** sets the snap; hold **Shift** while dragging to ignore it. **Ctrl+wheel** zooms around the
mouse, **wheel** scrolls in time, **Shift+wheel** scrolls in pitch.

### Computer keyboard piano

While the editor has focus (you clicked in it last), letter keys play notes through the track's
instrument:

```
 W  E     T  Y  U     O  P
A  S  D  F  G  H  J  K  L  ;
C4 D4 E4 F4 G4 A4 B4 C5 D5 E5
```

Click the arrangement to give keyboard focus back to it.

---

## Transport

| Control | Action |
|---------|--------|
| **⏮** (Home) | Back to the loop start, press again for bar 1 |
| **▶ PLAY / ■ STOP** (Space) | Play from the playhead; stopping leaves the playhead where it stopped |
| **⏹** | Stop; when already stopped, return to the start |
| **● REC** | Record the master output — see *Recording* |
| Position | Bar.beat.sixteenth and elapsed time |
| **BPM** | Type a tempo and press Enter; **↑/↓** nudge by 1 (Shift: 10). Changing it while playing doesn't jump the playhead |
| **4/4** | Beats per bar |
| **↻ LOOP** (L) | Loop the range shown on the ruler |
| **♩ CLICK** (K) | Metronome, accented on the downbeat |

---

## The Drum Machine

Drums live on **drum tracks** in the arrangement. Select a drum clip — or a drum track — and the
**EDITOR** tab of the dock shows this step sequencer. Every sound is synthesized live by the Web
Audio API — there are no sample files, so nothing to download and nothing to go missing. Drum
voices feed the master FX rack; see **Master Effects** for the room they sit in.

### Playing a pattern

Drum clips play **drum patterns** from a shared library of 34 genre presets plus anything you make.

1. Double-click a drum track's lane — a clip appears using the pattern currently selected in the editor
2. Pick a different pattern from the dropdown (grouped by genre) and it swaps into the selected clip
3. Stretch the clip and the pattern repeats to fill it, like any other clip

Several clips can play the same pattern; the editor says so (“Used by 3 clips”) because editing it
changes all of them. Use **⧉** (duplicate) first if you want a variation for one section.

**▶ AUDITION** loops the pattern on its own, which is handy while building a beat. The song's
transport plays the arrangement.

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

Open the **INSTRUMENTS** tab of the dock (Alt+I). This is a library of 161 synthesized instruments across
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

1. Select an instrument track in the arrangement (click its header)
2. Hover a preset card and click **SET**

The card shows **ON TRACK** for the selected track's current sound, and every card lists which
tracks use it. Changing a track's sound is undoable (Ctrl+Z).

You can also open this tab from a track: click the sound name under the track's name, or use the
track's ⋯ menu → **Choose instrument…**.

> The track's channel strip still applies on top — its fader, pan, EQ and sends.

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

## The Mixer

Open the **MIXER** tab (Alt+X). Every track has a channel strip; the master strip is on the right.

| Section | Controls |
|---------|----------|
| **EQ** | HI (high shelf, 4 kHz), MID (peak, 1.2 kHz), LO (low shelf, 200 Hz), ±18 dB. Double-click to reset |
| **SENDS** | REV / DLY / CHO — this track's level into the master reverb, delay and chorus |
| **SC** | Sidechain: how far this track ducks under the kick |
| Meter + fader | Post-fader peak level for *this track*, and its level up to 150% (double-click: 100%) |
| **PAN** | Stereo position (double-click: centre) |
| **M** / **S** | Mute and solo — the same as the track header |

A label shown dim is being driven by an automation lane; the control is ignored while the lane is on.

### Sidechain ducking

Turn **SC** up on a bass or pad and every kick on a drum track pulls it down briefly. This is what
makes four-to-the-floor music breathe: the kick and bass stop masking each other on every downbeat.
Start around 50–70% on sub and bass, 20–30% on pads, and leave leads alone.

Any of the three kick voices on any drum track triggers it. Kicks are never ducked themselves unless
you turn SC up on the drum track.

### Two layers of sends

A preset carries its own send levels (the instrument's character, set in the **INSTRUMENTS**
right-click editor) and the channel adds its own on top (the mix engineer's choice). Preset sends
default low and channel sends default to zero, so nothing doubles up until you ask for it.

---

## Master Effects

Open the **FX** tab of the dock (Alt+F). These are **send** effects: instead of each sound carrying its own
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

## Automation

Automation draws how a parameter moves across the song instead of leaving it at one value — the
filter sweep under a build, a reverb throw on the last beat, a pad swelling in.

### Drawing a lane

1. Click **A** on a track header. An automation row opens directly underneath the track, lined up
   with its clips and sharing the arrangement's zoom and scroll
2. Pick a parameter from **+ parameter…** — Filter Cutoff, Resonance, Drive, Volume, Pan, the three
   EQ bands, or the three effect sends
3. **Click** in the row to add a point, **drag** to move one, **right-click** to delete; hold
   **Shift** to place off the grid

A track can have one lane per parameter; switch between them with the dropdown. **ON/OFF**
bypasses a lane without losing its points.

### What each lane does

| Lane | Applies to |
|------|-----------|
| **Filter Cutoff** | Replaces the instrument's own filter envelope for the whole note |
| **Resonance** | The filter's Q — push it high for whistling, self-oscillating sweeps |
| **Drive** | Sampled once per note (a distortion curve can't be ramped mid-note) |
| **Volume, Pan, EQ, Sends** | The track's channel strip, moving continuously |

Cutoff and resonance are written onto the live filter across each note's full length.
That is why a four-bar held chord keeps moving instead of freezing at whatever the
cutoff was when it started — and it is how you get the resonant, juddering sustained
chords that a lot of raw electronic material is built from.

### Automation beats the mixer

While a lane is enabled, it owns its parameter. The matching control in the mixer is
dimmed and ignored. Turn the lane **OFF** (the button keeps the points) to hand control
back to the fader.

### Lanes loop with the loop

Automation is written in song time, so it follows the arrangement: a sweep drawn under the
Drop plays wherever the Drop is. With **LOOP** on, the lane repeats with the loop.

---

## The Arpeggiator

Each instrument track has one, in the left column of the note editor. Click **ARP** to turn it on;
it applies to every clip on the track, and the track header shows an **ARP** badge.

Hold a chord — draw three or four long overlapping notes — and the arpeggiator expands
it into a running pattern at playback. Notes whose spans overlap are treated as one
chord; a new chord starts wherever the overlap breaks.

| Control | Effect |
|---------|--------|
| **Rate** | Step length, 1/1 down to 1/32 |
| **Mode** | `up`, `down`, `updown`, `downup`, `order` (as drawn), `random` |
| **OCT** | Stack the pattern up 1–4 octaves |
| **GATE** | How much of each step sounds, 5–100%. Low values stutter, high values run legato |

`updown` and `downup` don't repeat the turnaround note, so they swing like a pendulum
rather than stuttering at each end.

The piano roll still shows your long chords — the expansion happens on the way to the
audio engine, once per pattern. Editing four held notes is a great deal less work than editing sixty-four
sixteenths, and transposing the harmony is a three-note move.

---

## The Oscillator Lab

The oscillator lab is the original heart of OSC: raw waveforms, a live oscilloscope, and controls for
frequency, phase and pulse width. Switch to it with **OSC LAB** at the top right.

It's **optional**. Tracks play instrument presets by default and nothing in a song depends on the
lab. But any lab oscillator can be a track's sound — **+ Oscillator** in the arrangement, or a track's
⋯ menu → **Use an oscillator** — and then:

- the track plays its notes with that oscillator's waveform, pulse width and detune
- it's polyphonic, so chords work
- cutoff and resonance automation still apply (a low-pass filter sits after the oscillator)
- editing the oscillator in the lab changes how the track sounds; the lab tells you which tracks use it

Removing a lab oscillator that a track uses switches that track to Electric Piano rather than leaving
it silent. You'll be asked first.

### Lab tabs

| To… | Do this |
|-----|---------|
| Add an oscillator | **+ OSC** at the end of the tab bar |
| Rename | Double-click its tab |
| Reorder | Drag its tab |
| Remove | **×** on its tab (one always remains) |
| Hear it on its own | **▶ PLAY** in the controls — a continuous tone for sound design |

The lab's own mute and solo apply to these continuous tones only, not to arrangement tracks.

### Oscillator controls

#### Waveform

Four buttons select the oscillator waveform:

| Button | Waveform | Sound character |
|--------|----------|-----------------|
| `sine` | Sine | Pure, smooth, flute-like |
| `sqr`  | Square | Hollow, nasal, clarinet-like |
| `saw`  | Sawtooth | Bright, buzzy, string/brass-like |
| `tri`  | Triangle | Soft, mellow, between sine and square |

#### Frequency

- Range: **20 Hz – 20 000 Hz**
- The slider is **logarithmic** so equal slider distances correspond to equal musical intervals (octaves)
- Type a frequency directly into the numeric input on the right and press Enter or Tab to commit; press Escape to cancel

#### Amplitude

Controls how loud this oscillator is. Range **0.0 – 1.0**.

#### Phase

Shifts the starting point of the waveform. Audible only when two oscillators play the same frequency — shifting one by 180° (π radians) causes them to partially cancel. Range **0° – 360°**.

#### Pulse Width

Only active when the **square** waveform is selected. Controls the duty cycle — the fraction of each cycle that is high vs. low. At **50%** you get a standard square wave. At **10%** or **90%** the wave becomes thin and nasal. Range **1% – 99%**.

#### Tab Level

Per-oscillator volume, independent of Master Volume. Use this to balance oscillators relative to each other. Range **0 – 100%**.

#### Play / Stop

Starts or stops audio output for the **active tab** only. Each tab has its own independent play state.

#### Advanced Panel

Click **▾ Advanced** to expand:

| Control | What it does |
|---------|--------------|
| **Detune** | Shifts pitch up or down in cents (1/100 of a semitone). Range ±100¢. Useful for chorus/thickening effects when layering two oscillators |
| **Zoom (cycles)** | How many waveform cycles are visible in the oscilloscope. Higher = zoomed out, useful for seeing periodic structure at high frequencies |
| **Line thickness** | Oscilloscope waveform line width in pixels (1–4) |
| **Color theme** | Changes the accent color for this tab's oscilloscope and controls: Green, Amber, Blue, or White |
| **Show grid** | Toggle the amplitude grid lines and timing ruler in the oscilloscope |

### The oscilloscope

The large canvas in the middle of the screen renders a real-time waveform display at 60 fps. The horizontal axis is time (labeled in milliseconds or microseconds); the vertical axis is amplitude (−1.0 to +1.0).

#### Single mode (default)

Shows only the active tab's waveform, rendered in the tab's accent color. Amplitude grid lines and timing labels are drawn when **Show grid** is on.

#### Overlay mode

Click **OVERLAY** at the end of the lab tab bar. All oscillators are drawn simultaneously:

- Each oscillator renders in its tab color at 60% opacity (100% if it is the active tab)
- Muted oscillators render at 18% opacity
- A **white SUM** waveform is drawn on top, showing the mixed output clipped to ±1.0
- A legend in the top-right corner identifies each tab by color and label

To return to single mode, click **OVERLAY** again.

---

## The Visualizer

Click **VIZ** at the top right. It is **off by default and does not survive a reload** on
purpose — it taps the master bus with an FFT analyser and runs a redraw loop, which is
real CPU you shouldn't pay for unless you're looking at it.

Four modes: **Spectrum** (log-spaced bars), **Waveform**, **Radial** (bars around a
circle) and **Bloom** (concentric rings tracking frequency bands).

| Option | Effect |
|--------|--------|
| **SENS** | Input gain before drawing, 0.2–4× |
| **SMOOTH** | Analyser time smoothing. High is calm, low is twitchy |
| **DETAIL** | Bar count, 16–192 |
| **TRAIL** | Motion trail — 0 clears each frame, high values smear |
| **COLOR** | Theme (follows the active oscillator's colour), Spectrum, or Mono |
| **MIRROR / GLOW** | Symmetry, and shadow bloom |
| **FPS** | 60 or 30 |

Your option choices persist; the on/off state doesn't. If playback starts to crackle
while it's open, turn **GLOW** off first — shadow blur is by far the most expensive
thing here — then drop to 30 FPS.

---

## Recording

### Making a recording

Click **● REC** in the transport. If the song is stopped, playback starts from the playhead. The button
shows elapsed time while recording.

Click **● REC** again to finish — or just stop the transport, which ends the take so a recording never
trails off into silence.

### Downloading

**↓ WAV** and **↓ WebM** appear next to the REC button:

| Button | Format | When to use |
|--------|--------|-------------|
| **↓ WAV** | Uncompressed 16-bit PCM | Lossless — for any audio editor or DAW |
| **↓ WebM** | Compressed (Opus) | Smallest file |

The recording is taken after the master limiter, so it's exactly what you heard.

### Practical limits

- Length is limited by memory: compressed audio is roughly 6–12 KB per second
- WAV conversion decodes the whole take at once; for recordings over ~30 minutes use WebM

---

## Projects and Saving

### Your session is saved automatically

Everything — tracks, clips, patterns, sections, mixer, lab oscillators, drum patterns, effects — is
kept in the browser and restored when you come back. Saving is batched and skipped during playback,
so it costs nothing while you work.

### Project files

**OSC ▾** (the logo) is the file menu:

| Item | Action |
|------|--------|
| **New project** | Starts a fresh arrangement (asks first if this one has clips) |
| **Open…** (Ctrl+O) | Loads a `.oscproject` file |
| **Save** (Ctrl+S) | Downloads the project as `<project name>.oscproject` |
| **Open example** | Loads one of the bundled examples |

Click the project name next to the logo to rename it.

A project file contains the complete song: tracks and their sounds, clips, patterns, sections,
automation, mixer settings, tempo and loop — plus the drum patterns and lab oscillators it uses, so it
opens the same way on another computer. Patterns no clip uses are left out.

### Older project files

Files from before the arrangement view (format 1.0) still open. Each old track becomes a track with a
single clip holding its notes, at exactly the same positions. Those files didn't record which
instrument each track used, so one is picked from the part's range — a low part gets a bass, long
held notes a pad — and a notice says so. Change any of them from the track header.

Sessions saved in the browser by earlier versions migrate automatically, and keep their sound: a
track that had an instrument assigned keeps it, and one that played an oscillator keeps playing it
through the lab.

---

## Keyboard Shortcuts

Shortcuts never fire while you're typing in a text field.

### Everywhere

| Shortcut | Action |
|----------|--------|
| **Space** | Play / stop |
| **Home** | Return to start |
| **Ctrl+Z** / **Ctrl+Shift+Z** (or **Ctrl+Y**) | Undo / redo |
| **Ctrl+S** / **Ctrl+O** | Save / open project |
| **Alt+E / X / I / F** | Dock: Editor / Mixer / Instruments / FX |

### Arrangement (after clicking in it)

| Shortcut | Action |
|----------|--------|
| **Delete** | Delete the selected clip |
| **Ctrl+D** | Duplicate the selected clip |
| **Ctrl+E** | Split the selected clip at the playhead |
| **M** / **S** | Mute / solo the selected track |
| **↑** / **↓** | Select the track above / below |
| **L** / **K** | Toggle loop / metronome |
| **Escape** | Deselect the clip |
| **Alt**-drag | Copy a clip |
| **Shift**-drag | Move or trim off the grid |

### Editor (after clicking in it)

| Shortcut | Action |
|----------|--------|
| **A W S E D F T G Y H U J K O L P ;** | Play notes (C4 on A) |
| **Delete** | Delete selected notes |
| **Ctrl+A / C / V** | Select all / copy / paste |
| **↑ / ↓** (Shift: octave) | Transpose selected notes |
| **Q** | Quantize selected notes |
| **Escape** | Deselect notes |
| **Right-click** | Delete a note |

---

## Troubleshooting

| Problem | Likely cause | Solution |
|---------|-------------|----------|
| Nothing plays | The browser hasn't allowed audio yet | Click anywhere on the page, then press Play |
| A track is silent | Muted, another track is soloed, its clip is muted, or the fader is down | Check M/S on the track headers and the mixer |
| A drum clip shows “pattern missing” | Its pattern was deleted in the drum editor | Right-click the clip → *Drum pattern* and pick another |
| Notes past a point don't play | They're beyond the pattern's loop length | Drag the loop handle on the piano roll's ruler, or use the LOOP menu in the pattern column |
| Letter keys play notes instead of shortcuts | The editor has keyboard focus | Click the arrangement |
| A mixer control does nothing | An automation lane is driving it (its label is dim) | Turn the lane OFF, or edit the lane |
| Crackling with many tracks | CPU load | Close the visualizer, or turn its GLOW off and drop it to 30 FPS |
| WAV download fails | Very long take | Use WebM for recordings over ~30 minutes |
| An old project loads with odd instruments | Format 1.0 files don't record instruments | Pick the right ones from each track header — a notice explains this on load |
