/**
 * Standard MIDI File (type 1) export.
 *
 * Built from the same timeline the player uses, so looping clips are unrolled,
 * trims respected and (optionally) the arpeggiator baked in — the file holds
 * what you hear. Drum tracks go to channel 10 with General MIDI drum notes, and
 * each instrument track gets a GM program from its preset category, so the
 * file opens sensibly in any DAW or notation program.
 */

import { eventsInWindow, type TimelineInput } from '../engine/timeline';
import { expandArpCached } from '../engine/arpeggiator';
import { PRESETS_BY_ID, type InstrumentCategory } from '../engine/instruments';
import type { SequencerState, Track } from '../utils/music';
import type { DrumPattern } from '../store/drumStore';
import type { DrumVoiceType } from '../engine/sampler';

export const PPQ = 480;

/** General MIDI percussion key for each drum voice. */
const GM_DRUMS: Record<DrumVoiceType, number> = {
  'kick': 36, 'kick-808': 35, 'kick-tight': 36,
  'snare': 38, 'snare-808': 40, 'snare-brush': 38,
  'hihat-c': 42, 'hihat-o': 46, 'hihat-pedal': 44,
  'clap': 39, 'rim': 37, 'snap': 39,
  'tom-lo': 41, 'tom-mid': 45, 'tom-hi': 48,
  'crash': 49, 'splash': 55, 'ride': 51, 'ride-bell': 53, 'cymbal-rev': 57,
  'cowbell': 56, 'shaker': 70, 'cabasa': 69, 'tambourine': 54,
  'conga-hi': 62, 'conga-lo': 64, 'bongo': 60, 'timbale': 65,
  'woodblock': 76, 'clave': 75, 'triangle': 81,
  'zap': 39, 'sub-drop': 35,
};

/** A reasonable General MIDI program for each preset category. */
const GM_PROGRAM: Record<InstrumentCategory, number> = {
  'Piano': 0, 'Keys': 4, 'Organ': 16,
  'Synth Lead': 81, 'Synth Pad': 89, 'Synth Bass': 38, 'Synth Pluck': 84,
  'Electric Guitar': 27, 'Acoustic Guitar': 25, 'Bass Guitar': 33,
  'Strings': 48, 'Brass': 61, 'Woodwind': 73,
  'Mallets': 11, 'Plucked': 46, 'Vocal': 52, 'World': 104, 'FX': 99,
};

export interface MidiOptions {
  startBeat: number;
  endBeat: number;
  /** Write arpeggiated notes rather than the held chords. */
  bakeArpeggiator: boolean;
  drumPatterns: DrumPattern[];
}

// ─── Byte helpers ─────────────────────────────────────────────────────────────

function vlq(n: number): number[] {
  let v = Math.max(0, Math.round(n));
  const bytes = [v & 0x7f];
  while ((v >>= 7) > 0) bytes.unshift((v & 0x7f) | 0x80);
  return bytes;
}

function text(s: string): number[] {
  // MIDI text is nominally ASCII; keep it 7-bit safe
  return Array.from(s.replace(/[^\x20-\x7e]/g, '?').slice(0, 120), (c) => c.charCodeAt(0));
}

function chunk(type: string, data: number[]): number[] {
  const len = data.length;
  return [...text(type), (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff, ...data];
}

interface MidiEvent { tick: number; order: number; bytes: number[] }

function trackChunk(events: MidiEvent[]): number[] {
  // Note-offs before note-ons at the same tick, so repeated notes retrigger
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const data: number[] = [];
  let last = 0;
  for (const e of events) {
    data.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  data.push(...vlq(0), 0xff, 0x2f, 0x00); // end of track
  return chunk('MTrk', data);
}

// ─── Encoder ──────────────────────────────────────────────────────────────────

export function encodeMidi(seq: SequencerState, title: string, opts: MidiOptions): Uint8Array {
  const toTick = (beat: number) => Math.round((beat - opts.startBeat) * PPQ);
  const noLoop = { enabled: false, start: 0, end: 0 };

  // Conductor track: name, tempo, time signature
  const usPerQuarter = Math.round(60_000_000 / seq.bpm);
  const denomPow = 2; // quarter-note beats
  const conductor: MidiEvent[] = [
    { tick: 0, order: 0, bytes: [0xff, 0x03, ...vlq(text(title).length), ...text(title)] },
    { tick: 0, order: 0, bytes: [0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff] },
    { tick: 0, order: 0, bytes: [0xff, 0x58, 0x04, seq.beatsPerBar, denomPow, 24, 8] },
  ];
  for (const m of seq.markers) {
    if (m.beat < opts.startBeat || m.beat >= opts.endBeat) continue;
    const t = text(m.name);
    conductor.push({ tick: toTick(m.beat), order: 0, bytes: [0xff, 0x06, ...vlq(t.length), ...t] });
  }

  const drumPatterns = new Map(opts.drumPatterns.map((p) => [p.id, p]));
  const tracks: number[][] = [trackChunk(conductor)];
  let melodicChannel = 0;

  for (const track of seq.tracks) {
    if (track.clips.length === 0) continue;
    const isDrums = track.source.type === 'drums';
    // Channel 10 (index 9) is reserved for drums; melodic tracks skip it
    let channel = 9;
    if (!isDrums) {
      channel = melodicChannel;
      melodicChannel = melodicChannel === 8 ? 10 : (melodicChannel + 1) % 16;
    }

    const input: TimelineInput = {
      tracks: [track],
      patterns: seq.patterns,
      drumPatterns,
      notesFor: (t: Track, p) => (opts.bakeArpeggiator ? expandArpCached(`${t.id}:${p.id}`, p.notes, t.arp) : p.notes),
      metronome: false,
      beatsPerBar: seq.beatsPerBar,
    };

    const name = text(track.name);
    const events: MidiEvent[] = [
      { tick: 0, order: 0, bytes: [0xff, 0x03, ...vlq(name.length), ...name] },
    ];
    if (!isDrums && track.source.type === 'preset') {
      const preset = PRESETS_BY_ID.get(track.source.presetId);
      const program = preset ? GM_PROGRAM[preset.category] : 0;
      events.push({ tick: 0, order: 1, bytes: [0xc0 | channel, program] });
    }
    // Pan as CC 10 so the stereo picture survives
    events.push({ tick: 0, order: 1, bytes: [0xb0 | channel, 10, Math.round((track.pan + 1) * 63.5)] });

    for (const e of eventsInWindow(input, opts.startBeat, opts.endBeat, noLoop, false)) {
      if (e.kind === 'click') continue;
      const key = e.kind === 'drum' ? GM_DRUMS[e.voice.id] : e.midiNote;
      const vel = Math.max(1, Math.min(127, Math.round(e.kind === 'drum' ? e.step.velocity : e.velocity)));
      const swing = e.kind === 'drum' ? e.swingBeats : 0;
      const on = toTick(e.songBeat + swing);
      const lengthBeats = e.kind === 'drum' ? 0.125 : e.durationBeats;
      // Notes can't run past the end of the export
      const off = Math.max(on + 1, Math.min(toTick(e.songBeat + swing + lengthBeats), toTick(opts.endBeat)));
      events.push({ tick: on, order: 2, bytes: [0x90 | channel, key & 0x7f, vel] });
      events.push({ tick: off, order: 0, bytes: [0x80 | channel, key & 0x7f, 0] });
    }

    tracks.push(trackChunk(events));
  }

  const header = chunk('MThd', [0, 1, (tracks.length >> 8) & 0xff, tracks.length & 0xff, (PPQ >> 8) & 0xff, PPQ & 0xff]);
  return new Uint8Array([...header, ...tracks.flat()]);
}
