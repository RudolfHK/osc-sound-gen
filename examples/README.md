# Example Projects

Eight projects ship with the app. Open them from **OSC ▾ → Open example**, or load a file from this
folder with **OSC ▾ → Open…**. Each one carries its own tracks, instruments, sections, mixer settings and
drum patterns, so it plays exactly as written — just press **Space**.

All of them are original compositions. The Minecraft-style pieces are written *in the style of* C418's
soundtrack — similar mood, keys and phrasing — not transcriptions of the recordings.

---

## Production demo

### midnight-drive
**6 tracks · 118 BPM · 16 bars · A minor · sections: Intro → Groove → Lead → Peak**

An original French-touch / synthwave study and the best tour of the app. Things to look at:

| Track | Sound | What it shows |
|-------|-------|---------------|
| Drums | House pattern | One drum clip from the Groove onwards |
| Sub | Sub Bass | A 4-bar pattern looped across three sections; sidechain 70% |
| Bass | Reese Bass | Same idea, with a filter cutoff lane opening over the song |
| Arp | House Pluck | **ARP on** (1/16, up, 2 octaves) — the clip holds three-note chords and the arpeggiator does the rest. It enters at bar 3, so the clip starts two bars into its pattern to stay on the right chord |
| Pad | Warm Pad | Its automation row is open: resonance rising under held chords |
| Lead | Supersaw | An 8-bar melody clip in the Lead and Peak sections |

Try right-clicking the **Groove** section → **Duplicate section** to make the song longer, or
**Loop this section** to work on one part.

### midnight-drive-extended
**11 tracks · 118 BPM · 98 bars (≈ 3:20) · A minor · sections: Intro → Build → Groove → Lead → Breakdown →
Build 2 → Drop → Bridge → Outro**

The full-length song version of Midnight Drive: the same key, chords, sounds and melody, arranged the
way a finished club track is.

| Section | Bars | What happens |
|---------|------|--------------|
| Intro | 1–8 | Filtered pad; the arp enters at bar 5 |
| Build | 9–16 | Hats and shaker only, sub and Reese bass come in under a closed filter; a one-bar snare roll and a reverse swell lead into… |
| Groove | 17–32 | The full house beat with a crash on the downbeat. Rhodes off-beat stabs join halfway |
| Lead | 33–48 | The supersaw melody from the original, twice |
| Breakdown | 49–56 | Drums and bass drop out. A **breath choir** holds the chords and **handbells** play the hook an octave up |
| Build 2 | 57–64 | Hats, then 8th-note snares, then the roll; bass filter closes right down, pad resonance climbs |
| Drop | 65–80 | Everything at once. The lead plays **variation B**, whose answer phrase climbs instead of settling, over a **legato violin** counter-line; the choir returns for the second half |
| Bridge | 81–88 | A new progression, **F – G – Em – Am** (VI–VII–v–i), over a half-time beat; the violins take the melody |
| Outro | 89–98 | One more house pass with the lead's opening phrase and the bells, then the drums stop, arp and pad fade on volume lanes, and everything lands on a held A-minor chord |

Things to look at:

- **Different chords in one song** — the bridge uses its own patterns for every part (`Sub · bridge`,
  `Pad · bridge`…), so each track's lane shows where the harmony changes
- **Automation across a whole song** — the bass cutoff closes before each drop and opens on it; the pad's
  resonance builds through both build-ups; the Arp and Pad tracks have **volume** lanes that fade the outro
- **New instruments** — Breath Choir, Handbells, Legato Violins and the Reverse Swell FX are from the
  expanded library
- **Drum arrangement with clips** — six short drum patterns (house, house + crash, hats, 8th build, roll,
  half-time) placed as clips instead of one long loop

All of it is checked by a test that walks the song bar by bar and confirms the arp, sub, keys and choir
always play the pad's chord.

---

## Minecraft-style studies

No drums — the style doesn't use them. Each has an **A** and **B** section (or theme and variation).

| Project | Tempo · key | Tracks |
|---------|-------------|--------|
| **minecraft-sweden** | 72 BPM · A minor | Melody (Felt Piano), Bass (Sub Bass), Pad (Warm Pad) |
| **minecraft-wet-hands** | 84 BPM · C major | Piano (Grand Piano), Chords (Glass Pad), Bass (Finger Bass) |
| **minecraft-subwoofer-lullaby** | 76 BPM · C minor | Melody (Vibraphone), Bass (Sub Bass), Pad (Dark Pad) |
| **minecraft-haggstrom** | 96 BPM · A minor | Melody (Felt Piano), Arpeggio (Harp), Bass (Sub Bass) |

Good ones for trying other sounds: select a track and pick something else in the **INSTRUMENTS** tab —
*Music Box* or *Celesta* on a melody, *Chamber Strings* under the chords.

---

## Other styles

| Project | Tempo · key | Tracks |
|---------|-------------|--------|
| **ambient-cosmos** | 60 BPM · A major | Lead (Vapor Pad), Choir (Choir Oohs), Sub (Sub Bass) — long overlapping notes, a test of release tails and reverb |
| **arp-sequence** | 134 BPM · C major | Arp (Supersaw), Bass (Acid Bass) over a Techno drum clip that enters in the second section |

---

## Making your own

1. Build a song in the arrangement
2. **OSC ▾ → Save** (Ctrl+S) downloads it as `<project name>.oscproject`
3. Share the file — it contains everything needed to play it, including any drum patterns and
   lab oscillators it uses

To add a project to this list, drop the `.oscproject` file in this folder; it appears in the
**Open example** menu on the next build.
