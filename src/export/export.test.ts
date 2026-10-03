import { describe, it, expect } from 'vitest';
import { encodeWav, wavSize, type PcmAudio } from './wav';
import { integratedLoudness, samplePeak, normalizationGain, normalizeInPlace, gainToDb } from './loudness';
import { encodeMidi, PPQ } from './midi';
import { id3v2 } from './id3';
import { makeDefaultSequencerState, makeTrack, makePattern, makeClip } from '../utils/music';
import type { DrumPattern } from '../store/drumStore';

const sine = (freq: number, amp: number, seconds: number, sr: number) =>
  Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => amp * Math.sin(2 * Math.PI * freq * i / sr));

const ascii = (v: DataView, at: number, n = 4) =>
  String.fromCharCode(...Array.from({ length: n }, (_, i) => v.getUint8(at + i)));

// ─── WAV ──────────────────────────────────────────────────────────────────────

describe('WAV encoder', () => {
  const audio: PcmAudio = {
    sampleRate: 48000,
    channels: [Float32Array.from([0, 0.5, -1, 1]), Float32Array.from([0.25, -0.25, 0, 0])],
  };

  it('writes a valid 16-bit PCM header and interleaved samples', () => {
    const v = new DataView(encodeWav(audio, { bitDepth: 16 }));
    expect(ascii(v, 0)).toBe('RIFF');
    expect(ascii(v, 8)).toBe('WAVE');
    expect(v.getUint16(20, true)).toBe(1);       // PCM
    expect(v.getUint16(22, true)).toBe(2);       // channels
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint32(28, true)).toBe(48000 * 4); // byte rate
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(4 * 4);   // data bytes
    expect(v.getUint32(4, true)).toBe(v.byteLength - 8);
    // frame 1 left = 0.5, frame 0 right = 0.25
    expect(v.getInt16(44 + 4, true)).toBe(16384);
    expect(v.getInt16(44 + 2, true)).toBe(8192);
    expect(v.getInt16(44 + 12, true)).toBe(32767); // +1 clips to full scale
  });

  it('writes 24-bit samples as signed little-endian triples', () => {
    const v = new DataView(encodeWav(audio, { bitDepth: 24 }));
    expect(v.getUint16(34, true)).toBe(24);
    expect(v.getUint16(32, true)).toBe(6); // block align
    const read24 = (at: number) => {
      const x = v.getUint8(at) | (v.getUint8(at + 1) << 8) | (v.getUint8(at + 2) << 16);
      return x & 0x800000 ? x - 0x1000000 : x;
    };
    expect(read24(44 + 6)).toBe(Math.round(0.5 * 8388607)); // frame 1 left
    expect(read24(44 + 12)).toBe(-8388607);                   // frame 2 left = −1
  });

  it('writes 32-bit float with a fact chunk and exact samples', () => {
    const v = new DataView(encodeWav(audio, { bitDepth: 32 }));
    expect(v.getUint16(20, true)).toBe(3); // IEEE float
    expect(v.getUint32(16, true)).toBe(18);
    expect(ascii(v, 38)).toBe('fact');
    expect(v.getUint32(46, true)).toBe(4); // frames
    expect(ascii(v, 50)).toBe('data');
    expect(v.getFloat32(58 + 8, true)).toBeCloseTo(0.5, 7);
    expect(v.byteLength).toBe(wavSize(4, 2, 32));
  });

  it('dithers 16-bit by ±1 LSB of triangular noise', () => {
    const silent: PcmAudio = { sampleRate: 44100, channels: [new Float32Array(1)] };
    const seq = [0.9, 0.1];
    let i = 0;
    const v = new DataView(encodeWav(silent, { bitDepth: 16, dither: true, random: () => seq[i++ % 2] }));
    expect(v.getInt16(44, true)).toBe(1); // 0.9 − 0.1 rounds to one LSB
    const plain = new DataView(encodeWav(silent, { bitDepth: 16 }));
    expect(plain.getInt16(44, true)).toBe(0);
  });
});

// ─── Loudness ─────────────────────────────────────────────────────────────────

describe('loudness', () => {
  it('matches the BS.1770 reference: 0 dBFS 997 Hz in one channel reads −3.01 LUFS', () => {
    for (const sr of [44100, 48000, 96000]) {
      const l = sine(997, 1, 8, sr);
      const lufs = integratedLoudness({ sampleRate: sr, channels: [l, new Float32Array(l.length)] });
      expect(lufs, `${sr} Hz`).toBeCloseTo(-3.01, 1);
    }
  });

  it('adds both channels, so the same tone in stereo is about 3 dB louder', () => {
    const l = sine(997, 1, 8, 48000);
    expect(integratedLoudness({ sampleRate: 48000, channels: [l, l] })).toBeCloseTo(0, 1);
  });

  it('gates out silence instead of averaging it in', () => {
    const tone = sine(997, 1, 4, 48000);
    const withGap = new Float32Array(tone.length * 3);
    withGap.set(tone, 0);
    const a = integratedLoudness({ sampleRate: 48000, channels: [tone, new Float32Array(tone.length)] });
    const b = integratedLoudness({ sampleRate: 48000, channels: [withGap, new Float32Array(withGap.length)] });
    expect(Math.abs(a - b)).toBeLessThan(0.3);
    expect(integratedLoudness({ sampleRate: 48000, channels: [new Float32Array(48000)] })).toBe(Number.NEGATIVE_INFINITY);
  });

  it('never lets loudness normalization push peaks past the ceiling', () => {
    // A quiet but peaky mix: reaching −14 LUFS would need more gain than the peak allows
    const r = normalizationGain(0.5, -30, { mode: 'loudness', targetLufs: -14, ceilingDb: -1 });
    expect(r.ceilingLimited).toBe(true);
    expect(r.gainDb).toBeCloseTo(-1 - gainToDb(0.5), 6);
    const ok = normalizationGain(0.1, -30, { mode: 'loudness', targetLufs: -14, ceilingDb: -1 });
    expect(ok).toEqual({ gainDb: 16, ceilingLimited: false });
  });

  it('normalizes to a peak ceiling in place and reports the result', () => {
    const audio = { sampleRate: 48000, channels: [sine(440, 0.25, 2, 48000)] };
    const rep = normalizeInPlace(audio, { mode: 'peak', ceilingDb: -1 });
    expect(gainToDb(samplePeak(audio))).toBeCloseTo(-1, 3);
    expect(rep.peakDb).toBeCloseTo(-1, 3);
  });
});

// ─── MIDI ─────────────────────────────────────────────────────────────────────

describe('MIDI export', () => {
  const build = () => {
    const seq = makeDefaultSequencerState();
    const pat = makePattern('P', 1, [{ id: 'a', midiNote: 64, startBeat: 0, durationBeats: 0.5, velocity: 90 }]);
    const keys = makeTrack({ name: 'Keys', source: { type: 'preset', presetId: 'piano-grand' } });
    keys.clips = [makeClip(pat.id, 0, 4)]; // 1-beat pattern looped over a bar
    const drums = makeTrack({ name: 'Drums', source: { type: 'drums' } });
    drums.clips = [makeClip('dp', 0, 4)];
    const dp: DrumPattern = {
      id: 'dp', name: 'D', genre: 'x', stepCount: 16, swing: 0,
      voices: [{ id: 'kick', name: 'K', color: '', volume: 1, pan: 0, tone: 0.5, pitch: 0, decay: 1, muted: false, solo: false,
        steps: Array.from({ length: 16 }, (_, i) => ({ active: i === 0, velocity: 110, pitch: 0, decay: 1 })) }],
    };
    return {
      bytes: encodeMidi({ ...seq, bpm: 120, tracks: [keys, drums], patterns: { [pat.id]: pat } }, 'Song',
        { startBeat: 0, endBeat: 4, bakeArpeggiator: true, drumPatterns: [dp] }),
    };
  };

  it('writes a type-1 file with a conductor track and one track per part', () => {
    const { bytes } = build();
    const v = new DataView(bytes.buffer);
    expect(ascii(v, 0)).toBe('MThd');
    expect(v.getUint32(4)).toBe(6);
    expect(v.getUint16(8)).toBe(1);   // format 1
    expect(v.getUint16(10)).toBe(3);  // conductor + keys + drums
    expect(v.getUint16(12)).toBe(PPQ);
  });

  it('encodes tempo and unrolls looping clips', () => {
    const { bytes } = build();
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
    expect(hex).toContain('ff 51 03 07 a1 20'); // 500 000 µs per quarter = 120 BPM
    // E4 (0x40) on channel 1 — once per beat across the 4-beat clip
    expect(hex.split('90 40 5a').length - 1).toBe(4);
  });

  it('puts drums on channel 10 with General MIDI keys', () => {
    const { bytes } = build();
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
    expect(hex).toContain('99 24 6e'); // note-on ch10, key 36 (kick), velocity 110
  });
});

// ─── ID3 ──────────────────────────────────────────────────────────────────────

describe('ID3 tag', () => {
  it('writes an ID3v2.3 header with a synchsafe size', () => {
    const tag = id3v2({ title: 'Midnight Drive', artist: 'Me' });
    expect(String.fromCharCode(...tag.slice(0, 3))).toBe('ID3');
    expect(tag[3]).toBe(3);
    const size = (tag[6] << 21) | (tag[7] << 14) | (tag[8] << 7) | tag[9];
    expect(size).toBe(tag.length - 10);
    expect([tag[6], tag[7], tag[8], tag[9]].every((b) => b < 0x80)).toBe(true);
  });
});
