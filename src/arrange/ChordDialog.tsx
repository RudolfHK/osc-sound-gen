import { useMemo, useState } from 'react';
import { useAppStore, useAccent } from '../store/appStore';
import { Dialog } from '../ui/kit/Dialog';
import { Button } from '../ui/kit/Button';
import {
  QUALITIES, QUALITY_ORDER, chordName, chordTones, diatonicChords, keyName, keyUsesFlats, noteName, parseChord,
  type ChordMark, type ChordQuality, type SongKey,
} from '../utils/harmony';
import { detectSongKey } from '../utils/songAnalysis';
import { previewNote } from '../sequencer/PianoRoll';

type ChordValue = Pick<ChordMark, 'root' | 'quality' | 'bass'>;

/** The key to write chords in: the chosen one, else detected, else C major. */
export function useSongKey(): { key: SongKey; detected: SongKey | null; chosen: boolean } {
  const { state } = useAppStore();
  const seq = state.sequencer;
  const detected = useMemo(
    () => detectSongKey(seq.tracks, seq.patterns, seq.songLengthBars * seq.beatsPerBar, seq.beatsPerBar),
    [seq.tracks, seq.patterns, seq.songLengthBars, seq.beatsPerBar],
  );
  return { key: seq.songKey ?? detected ?? { tonic: 0, mode: 'major' }, detected, chosen: !!seq.songKey };
}

const ALL_KEYS: SongKey[] = Array.from({ length: 24 }, (_, i) => ({ tonic: i % 12, mode: i < 12 ? 'major' : 'minor' }));

/**
 * Add or edit a chord on the chord track: pick from the key's own chords,
 * type a symbol ("Am7", "F/C"), or build one from root, type and bass.
 */
export function ChordDialog({ beat, existing, onClose }: { beat: number; existing?: ChordMark; onClose: () => void }) {
  const { state, dispatch } = useAppStore();
  const accent = useAccent();
  const seq = state.sequencer;
  const { key, detected, chosen } = useSongKey();
  const flats = keyUsesFlats(key);
  const [value, setValue] = useState<ChordValue>(existing ?? diatonicChords(key)[0].chord);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [sevenths, setSevenths] = useState(false);
  const bar = Math.floor(beat / seq.beatsPerBar) + 1;
  const beatInBar = (beat % seq.beatsPerBar) + 1;

  const apply = (v: ChordValue) => {
    if (existing) dispatch({ type: 'CHORD_UPDATE', id: existing.id, patch: { root: v.root, quality: v.quality, bass: v.bass } });
    else dispatch({ type: 'CHORD_SET', beat, chord: v });
    onClose();
  };

  // Hear it through the selected track's sound (or the first instrument track)
  const listen = (v: ChordValue) => {
    const track = seq.tracks.find((t) => t.id === seq.selectedTrackId && t.source.type !== 'drums')
      ?? seq.tracks.find((t) => t.source.type !== 'drums');
    if (!track) return;
    const root = 48 + v.root;
    for (const m of chordTones(v, root)) previewNote(track, state.tabs, m, 90);
    if (v.bass !== undefined) previewNote(track, state.tabs, 36 + v.bass, 90);
  };

  const pick = (v: ChordValue) => { setValue(v); setError(''); listen(v); };
  const select = 'bg-neutral-950 border border-neutral-700 text-xs text-neutral-200 px-1.5 py-1';
  const chip = (on: boolean) => `px-2 py-1 text-xs border ${on ? '' : 'border-neutral-700 text-neutral-300 hover:border-neutral-500'}`;
  const onStyle = { borderColor: accent, color: accent, backgroundColor: accent + '18' };

  return (
    <Dialog title={existing ? `Chord at bar ${bar}` : `Add a chord at bar ${bar}${beatInBar > 1 ? `, beat ${beatInBar}` : ''}`} onClose={onClose} className="w-[560px]">
      <div className="px-4 py-3 space-y-3">
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <label htmlFor="chord-key">Key</label>
          <select id="chord-key" className={select}
            value={chosen ? `${seq.songKey!.tonic}-${seq.songKey!.mode}` : 'auto'}
            onChange={(e) => {
              const v = e.target.value;
              dispatch({ type: 'SEQ_SET_KEY', key: v === 'auto' ? null : { tonic: +v.split('-')[0], mode: v.split('-')[1] as SongKey['mode'] } });
            }}>
            <option value="auto">{detected ? `Detected: ${keyName(detected)}` : 'Detect from the notes'}</option>
            {ALL_KEYS.map((k) => <option key={`${k.tonic}-${k.mode}`} value={`${k.tonic}-${k.mode}`}>{keyName(k)}</option>)}
          </select>
          <label className="flex items-center gap-1 ml-auto">
            <input type="checkbox" checked={sevenths} onChange={(e) => setSevenths(e.target.checked)} style={{ accentColor: accent }} />
            Sevenths
          </label>
        </div>

        <section aria-label={`Chords in ${keyName(key)}`}>
          <div className="text-[11px] tracking-widest text-neutral-500 mb-1">IN {keyName(key).toUpperCase()}</div>
          <div className="flex flex-wrap gap-1">
            {diatonicChords(key, sevenths).map((d) => {
              const on = value.root === d.chord.root && value.quality === d.chord.quality && value.bass === undefined;
              return (
                <button key={d.numeral} className={chip(on)} style={on ? onStyle : undefined} aria-pressed={on}
                  onClick={() => pick(d.chord)} onDoubleClick={() => apply(d.chord)}
                  title="Click to hear it, double-click to use it">
                  <span className="text-neutral-500 mr-1">{d.numeral}</span>{chordName(d.chord, flats)}
                </button>
              );
            })}
          </div>
        </section>

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = parseChord(text);
            if (!parsed) { setError(`“${text}” isn't a chord symbol I know — try Am7, F/C, B♭maj7, Dsus4.`); return; }
            apply(parsed);
          }}
        >
          <label htmlFor="chord-text" className="text-xs text-neutral-400 shrink-0">Type a chord</label>
          <input id="chord-text" value={text} onChange={(e) => { setText(e.target.value); setError(''); }}
            placeholder="Am7, F/C, B♭maj7…" data-autofocus=""
            className="flex-1 bg-neutral-950 border border-neutral-600 text-sm text-neutral-100 px-2 py-1" />
        </form>
        {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}

        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-center text-xs text-neutral-400">
          <span>Root</span>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Root">
            {Array.from({ length: 12 }, (_, pc) => (
              <button key={pc} className={`w-9 ${chip(value.root === pc)}`} style={value.root === pc ? onStyle : undefined}
                aria-pressed={value.root === pc} onClick={() => pick({ ...value, root: pc })}>{noteName(pc, flats)}</button>
            ))}
          </div>
          <label htmlFor="chord-quality">Type</label>
          <select id="chord-quality" className={select} value={value.quality}
            onChange={(e) => pick({ ...value, quality: e.target.value as ChordQuality })}>
            {QUALITY_ORDER.map((q) => <option key={q} value={q}>{QUALITIES[q].name}{QUALITIES[q].symbol ? ` (${QUALITIES[q].symbol})` : ''}</option>)}
          </select>
          <label htmlFor="chord-bass">Bass</label>
          <select id="chord-bass" className={select} value={value.bass ?? ''}
            onChange={(e) => pick({ ...value, bass: e.target.value === '' ? undefined : +e.target.value })}>
            <option value="">The root</option>
            {Array.from({ length: 12 }, (_, pc) => <option key={pc} value={pc}>{noteName(pc, flats)}</option>)}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 pb-4">
        <span className="text-lg text-neutral-100 font-mono min-w-[80px]" aria-live="polite">{chordName(value, flats)}</span>
        <Button onClick={() => listen(value)}>▶ Hear it</Button>
        <span className="ml-auto" />
        {existing && (
          <Button variant="danger" onClick={() => { dispatch({ type: 'CHORD_REMOVE', id: existing.id }); onClose(); }}>Remove</Button>
        )}
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => apply(value)}>{existing ? 'Change' : 'Add'}</Button>
      </div>
    </Dialog>
  );
}
