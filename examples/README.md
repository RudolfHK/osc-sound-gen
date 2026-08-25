# OSC Synthesizer — Example Projects

These `.oscproject` files demonstrate what the sequencer can do. Load them via **↑ LOAD** in the sequencer toolbar.

> **Tip:** Open the right number of OSC tabs before loading — use **+ ADD OSC** in the tab bar
> to match the track count below. Tracks are matched to tabs by position, so a project with
> three tracks needs three tabs.

> **Note on the Minecraft pieces:** these are original arrangements written *in the style of*
> C418's Minecraft soundtrack — same mood, key centres, and phrasing ideas — not transcriptions
> of the copyrighted recordings.

---

## Minecraft-style

### minecraft-sweden.oscproject
**3 tracks — 72 BPM — A minor**

Gentle arpeggiated melody over slow bass and an ambient pad. The calmest of the set.

| Track | Role | Suggested instrument |
|-------|------|----------------------|
| 1 | Melody | *Keys → Music Box* or *Electric Piano* |
| 2 | Bass | *Synth Bass → Sub Bass* |
| 3 | Pad | *Synth Pad → Warm Pad* |

### minecraft-wet-hands.oscproject
**3 tracks — 84 BPM — C major**

Continuous eighth-note piano figure over sustained thirds and a walking bass. The busiest melody line of the three.

| Track | Role | Suggested instrument |
|-------|------|----------------------|
| 1 | Piano figure | *Keys → Electric Piano* |
| 2 | Chord bed | *Synth Pad → Glass Pad* |
| 3 | Bass | *Bass Guitar → Finger Bass* |

### minecraft-subwoofer-lullaby.oscproject
**3 tracks — 76 BPM — C minor**

Bass-forward, as the name suggests: a prominent octave-jumping bass line under a sparse melody and quiet pad.

| Track | Role | Suggested instrument |
|-------|------|----------------------|
| 1 | Melody | *Keys → Celesta* or *Plucked → Kalimba* |
| 2 | Lead bass | *Synth Bass → Sub Bass* |
| 3 | Pad | *Synth Pad → Dark Pad* |

### minecraft-haggstrom.oscproject
**3 tracks — 96 BPM — A minor**

Brighter and more rhythmic — a rising melody over a constant sixteenth-ish arpeggio.

| Track | Role | Suggested instrument |
|-------|------|----------------------|
| 1 | Melody | *Keys → Electric Piano* |
| 2 | Arpeggio | *Plucked → Harp* or *Acoustic Guitar → Nylon Classical* |
| 3 | Bass | *Synth Bass → Sub Bass* |

---

## Other styles

### ambient-cosmos.oscproject
**3 tracks — 60 BPM — A major**

Slow evolving pad textures with long, deliberately overlapping notes. Good for testing the
multi-oscillator mix and long release tails.

| Track | Role | Suggested instrument |
|-------|------|----------------------|
| 1 | Lead | *Synth Pad → Vapor Pad* |
| 2 | Mid pad | *Synth Pad → Choir Pad* |
| 3 | Sub bass | *Synth Bass → Sub Bass* |

### arp-sequence.oscproject
**2 tracks — 134 BPM — C major**

Fast 16th-note arpeggio demonstrating the piano roll at high note density.

| Track | Role | Suggested instrument |
|-------|------|----------------------|
| 1 | Arp lead | *Synth Lead → Supersaw* |
| 2 | Bass hits | *Synth Bass → Acid Bass* |

Pair this one with the **Techno** or **House** drum pattern at the same BPM.

---

## Adding drums

Open the **DRUMS** panel and pick a pattern that fits the tempo:

| Project | Suggested pattern |
|---------|-------------------|
| minecraft-* | none, or *Jazz Brush* very quietly |
| ambient-cosmos | none |
| arp-sequence | *Techno* or *House* |

Leave **SYNC** enabled so the drum machine follows the sequencer's BPM.

---

## Creating your own

1. Build a composition in the sequencer
2. Assign instruments from the **INSTRUMENTS** panel if you want more than a raw oscillator
3. Click **↓ SAVE** to export as `.oscproject`
4. Share the file — it contains all note data, BPM, and track pan settings

Instrument assignments and drum patterns are stored separately in your browser (they persist
across reloads but do not travel inside the `.oscproject` file).
