# Proposal: Audio to Instrument

*Status: research and plan only — not implemented.*

Import a song or audio file, cut out a snippet, let OSC analyse it, then choose an instrument or
oscillator and have the app play back what it heard — the notes, as closely as it can reproduce them.

---

## 1. Verdict

**Feasible, entirely in the browser, and a good fit for the existing architecture — with one honest
caveat about what "sounds similar" will mean.**

The app can reliably recover **the notes** (pitch, timing, length, loudness) from clear material and
play them on any of its 219 instruments, and it can **suggest which preset is closest in character**.
It cannot make a synth preset reproduce a recorded instrument's exact tone, and on a full,
dense mix the transcription gets noticeably less accurate.

| | Estimate |
|---|---|
| Useful first version (phases 1–3 below) | **≈ 3–5 weeks** for one developer |
| Full version with stem separation (phase 5) | **+ 2–4 weeks**, and a 126–172 MB model download |
| Risk | Low for import/editing and single melodic lines; medium for polyphonic transcription of full mixes |

These are estimates from the components' published behaviour and the codebase as it stands, not from
a prototype. Section 9 proposes a 1–2 day spike that would turn the key unknowns into measurements
before committing.

---

## 2. What the user would do

1. **Import** — drop or open an MP3, WAV, OGG, FLAC or M4A file.
2. **Cut** — a waveform editor: zoom, scrub, drag a selection, loop it, nudge the edges to zero
   crossings, snap to detected beats.
3. **Analyse** — choose what to listen for:
   - *Melody* (one note at a time — a lead, a bass line, a vocal)
   - *Chords and notes* (polyphonic — piano, guitar, pads)
   - *Drums* (kick, snare, hats)
4. **Review** — the result appears as a clip on a new track, with the original snippet on a
   reference audio track directly above it for A/B listening. Sliders for sensitivity, minimum note
   length, pitch range and quantize strength re-run the analysis live.
5. **Choose a sound** — pick any preset or lab oscillator, or ask for **suggestions**: the presets
   whose character is closest to the snippet, ranked.

Everything happens on the user's machine. No audio is uploaded.

---

## 3. How it would work

```
 file ──► decode ──► snippet editor ──► analysis ─────────────► notes / drum hits ──► clip on a track
         (browser)    (waveform, sel.)    │  tempo + key                                  ▲
                                          │  pitch tracking (mono)                        │
                                          │  note transcription (poly)                    │ plays through
                                          │  onset + band classification (drums)          │ chosen preset
                                          └► timbre descriptors ──► preset suggestions ───┘
```

### Stage by stage

**Decode.** `AudioContext.decodeAudioData` already decodes MP3, WAV, OGG and AAC in every major browser
(FLAC in most). Nothing to add.

**Snippet editor.** A canvas waveform (peak-per-pixel overview plus detail zoom) with a selection —
the same drawing and gesture patterns as the arrangement and piano roll. Low risk.

**Tempo and key.** Onset-strength autocorrelation gives tempo; a chroma profile matched against key
templates gives key. Both are textbook DSP and only need to be *good enough to set the grid* — the user
can override them.

**Melody (monophonic).** The pYIN pitch tracker, written in-house (about 200 lines), is accurate on
clean single lines and fast. Segmenting the pitch track into notes (stable regions, onsets, energy) is
where the tuning effort goes.

**Chords and notes (polyphonic).** [Spotify's Basic Pitch](https://github.com/spotify/basic-pitch-ts) is
the clear choice: an instrument-agnostic polyphonic transcription network published at ICASSP 2022,
reported to be competitive with much larger models, Apache-2.0, with an official TypeScript/browser
package. Its model is small — **0.9 MB** (measured: 742 KB weights + 175 KB graph) — but it runs on
TensorFlow.js, which must be lazy-loaded so the main app doesn't grow. It outputs note events with
onsets, offsets, pitch and amplitude, plus pitch-bend estimates.

**Drums.** Onset detection plus a per-hit spectral classification (low band → kick, mid noise → snare,
high band → hats) maps cleanly onto the existing drum step sequencer. This works on clean drum loops; on
full mixes the bass and other instruments cause false hits.

**Suggesting a preset.** OSC can already render any preset offline (the export engine). For each preset,
render a few reference notes once and store compact descriptors: spectral centroid and slope, MFCC-style
envelope, attack time, decay, harmonic-to-noise ratio, inharmonicity. Measure the same on the snippet's
clearest isolated notes and rank presets by distance. This finds the right *family* (pluck vs pad vs
bass vs bell, bright vs dark, short vs sustained); it won't match a specific recorded instrument's tone.

### Candidate components

| Need | Option | License | Size | Fit |
|------|--------|---------|------|-----|
| Decoding | Browser `decodeAudioData` | — | 0 | ✅ Use |
| Polyphonic transcription | [Basic Pitch](https://github.com/spotify/basic-pitch-ts) | Apache-2.0 | 0.9 MB model + TF.js runtime (lazy) | ✅ Use |
| ML runtime | TensorFlow.js / [ONNX Runtime Web](https://www.npmjs.com/package/onnxruntime-web) | Apache-2.0 / MIT | Several MB in the browser — to measure | ✅ Lazy-load |
| Monophonic pitch | pYIN, written in-house | ours (MIT) | tiny | ✅ Use |
| Audio features | [Meyda](https://www.npmjs.com/package/meyda) | MIT | ~0.5 MB package | ✅ Optional |
| Writing MIDI | Already in OSC (`src/export/midi.ts`) | ours | 0 | ✅ Reuse |
| Music analysis toolkit | Essentia.js | **AGPL-3.0** | ~10 MB | ❌ License incompatible with an MIT app |
| Pitch detection lib | pitchfinder | **GPL-3.0** | small | ❌ License — write pYIN instead |
| Stem separation | [HT-Demucs as ONNX](https://huggingface.co/monteslu/htdemucs-web-onnx) | MIT (Demucs) | **126–172 MB** | ⚠️ Optional phase 5 only |
| Timbre transfer | [DDSP / Tone Transfer](https://magenta.tensorflow.org/tone-transfer) | Apache-2.0 | per-instrument models | ⚠️ Different feature — see §6 |
| Synth parameter estimation | [InverSynth](https://arxiv.org/pdf/1812.06349) / InverSynth II | research | trained per synth | ❌ Research project |

---

## 4. How good would it be?

Expectations by input, for the notes (transcription) and the sound (preset match). These are
qualitative and based on the published behaviour of these techniques; the spike in §9 would put
numbers on them for OSC.

| Input | Notes recovered | Sounds like the original? |
|-------|-----------------|---------------------------|
| Solo melody — whistle, lead synth, sung line, bass guitar | **Very good.** Occasional octave slips on breathy or very low notes | Melody clearly recognisable; the tone is the preset's, not the original's |
| Solo piano or guitar | **Good.** Some missed notes in dense chords, extra notes from strong overtones, slightly smeared timing | Harmony and rhythm recognisable |
| Clean drum loop | **Good** for kick/snare/hats; fills and toms less reliable | Groove recognisable on the drum kit |
| Full instrumental mix (drums + bass + chords + lead) | **Fair to poor.** Drums and dense mids produce false notes; the result needs editing | A sketch of the parts, not a faithful copy |
| Full mix after stem separation (phase 5) | **Fair to good** per stem | Noticeably better separation of parts, at a large download and processing cost |
| Vocals with lyrics | The sung pitch line only | A melody on an instrument; words are lost |

The best framing for users is **"audio to MIDI, with a sound suggestion"**, not "make it sound like
the record". Everything the transcription produces lands in an ordinary, editable clip, so fixing the
inevitable wrong notes is easy in the piano roll.

---

## 5. Phased plan

Effort is for one developer who knows this codebase; it includes tests (unit tests on synthetic signals,
browser tests on short royalty-free clips).

| Phase | Delivers | Effort | Outcome |
|-------|----------|--------|---------|
| **1. Import & snippet editor** | Audio file import, waveform editor with selection/loop/zoom, a **reference audio track** that plays the snippet in the arrangement (also useful on its own) | 4–6 days | Users can sample and arrange any audio alongside their parts |
| **2. Melody transcription** | pYIN pitch tracking, note segmentation, tempo/key detection, quantize, result as a clip; sensitivity controls | 4–6 days | Hum, whistle, sing or import a lead/bass line → editable notes |
| **3. Polyphonic transcription + suggestions** | Basic Pitch in a worker (lazy-loaded), split-by-register into bass/chords/melody tracks, preset fingerprints and ranked suggestions | 6–9 days | Solo piano/guitar → chords and melody; full mixes → a sketch to edit |
| **4. Drums** | Onset detection + band classification into a drum pattern | 3–5 days | Drum loops → editable drum clip |
| **5. Stem separation** *(optional)* | HT-Demucs via ONNX Runtime Web on WebGPU, run before phases 2–4 | 2–4 weeks | Much better results on full mixes; 126–172 MB model, needs a capable GPU, and long GPU bursts can freeze the UI unless chunked |

**Phases 1–3 ≈ 3–5 weeks** make the core feature. Phase 4 is small and independent. Phase 5 is a
separate decision, best made after users have tried 1–4.

---

## 6. Related ideas, and why they're not the same feature

- **Timbre transfer (DDSP, Google Magenta's Tone Transfer).** Re-renders the *audio itself* as a
  violin, flute or sax, preserving every nuance of the performance. It sounds much closer to the
  original phrasing, but it bypasses OSC's instruments entirely, needs one trained model per target
  instrument, and doesn't produce editable notes. A possible later "re-render as…" effect, not a
  substitute for transcription.
- **Synth parameter matching (InverSynth and successors).** Learns to set a synthesizer's knobs so it
  reproduces a sound. This *is* "make the oscillator sound like this", but it's an active research area
  that needs a model trained against OSC's own synth engine. Weeks to months, uncertain quality — not
  for the first version. The preset-suggestion approach in phase 3 gets much of the practical benefit
  cheaply.

---

## 7. How it fits the existing code

Most of the heavy lifting already exists:

- **Offline renderer** (`src/export/render.ts`) — renders preset fingerprints for suggestions.
- **Timeline, clips and patterns** — transcription output is simply a new pattern on a new track.
- **Web Worker pattern** (`src/export/mp3.worker.ts`) — the model for running Basic Pitch and pYIN off
  the main thread.
- **Drum step sequencer** — the target for drum transcription.
- **Waveform/canvas UI conventions** — the arrangement and piano roll establish the gestures.

New pieces: an **audio clip** type (for the reference track) in the timeline and scheduler, the import
and snippet editor, the analysis modules, and a lazy-loaded ML chunk.

---

## 8. Risks and how to handle them

| Risk | Mitigation |
|------|------------|
| Users expect it to "sound like the song" | Name and describe it as audio-to-notes; always show the original on the reference track for A/B |
| TensorFlow.js adds to download size | Load only when the user first analyses polyphonic audio; measure in the spike |
| Long files are slow or memory-heavy | Analyse the snippet only, with a cap (e.g. 60 s); progress and cancel, as in export |
| Full mixes transcribe poorly | Offer "Melody" and "Chords" modes with pitch-range limits; phase 5 if demand justifies it |
| Licenses | Use only permissive components (Basic Pitch, TF.js / ONNX Runtime, Meyda); write pYIN rather than using GPL/AGPL libraries |
| Copyright | Analysis is local and nothing is uploaded. Transcribing a song for practice or learning is common, but notes taken from someone else's song may be protected if shared or released — a one-line note in the import dialog says so. Test fixtures must be self-made or royalty-free |

---

## 9. Recommendation and next step

Build **phases 1–3**, with phase 4 alongside if time allows. Hold phase 5 until people have used the
feature on real material.

Before that, a **1–2 day spike** would replace the estimates above with measurements:

1. Run Basic Pitch in the browser inside a worker on five short royalty-free clips — solo piano, solo
   guitar, a bass line, a lead synth, a full mix.
2. Measure: analysis time per second of audio on an average laptop; extra download size of
   TensorFlow.js; note precision and recall against hand-checked notes.
3. Build a crude preset suggestion from three descriptors and check whether the top three include the
   right family for each clip.

**Go criteria:** analysis faster than real time; at least 80 % of notes correct on the solo clips; the
ML runtime adds no more than a few MB and loads only on demand.

---

## Sources

- [Spotify Basic Pitch (TypeScript)](https://github.com/spotify/basic-pitch-ts) · [Basic Pitch](https://github.com/spotify/basic-pitch) · npm `@spotify/basic-pitch` 1.0.1, Apache-2.0 (model size measured from the package)
- [HT-Demucs for the browser (ONNX)](https://huggingface.co/monteslu/htdemucs-web-onnx) · [demucs-web](https://github.com/timcsy/demucs-web) · [WebNN stem separator](https://huggingface.co/webnn/stem-separator)
- [Magenta Tone Transfer](https://magenta.tensorflow.org/tone-transfer) · [Sounds of India — DDSP in TensorFlow.js](https://blog.tensorflow.org/2020/08/creating-sounds-of-india-with-tensorflow.html)
- [InverSynth: Deep Estimation of Synthesizer Parameter Configurations from Audio Signals](https://arxiv.org/pdf/1812.06349) · [InverSynth II (ISMIR 2023)](https://ismir2023program.ismir.net/poster_209.html)
- License and size data from the npm registry: `essentia.js` (AGPL-3.0), `pitchfinder` (GPL-3.0), `meyda` (MIT), `@tensorflow/tfjs` (Apache-2.0), `onnxruntime-web` (MIT), `@tonejs/midi` (MIT)
