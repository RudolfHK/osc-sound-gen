import { useEffect, useMemo, useState } from 'react';
import { useAppStore, useAccent } from '../store/appStore';
import { Dialog } from '../ui/kit/Dialog';
import { Button } from '../ui/kit/Button';
import { notify } from '../ui/notices';
import { sectionsFromMarkers, type Track, type TrackSource } from '../utils/music';
import { chordName, keyUsesFlats, type ChordMark } from '../utils/harmony';
import {
  PART_KINDS, PART_STYLES, chordSegments, generatePart, partStyle, splitPart, type PartKind, type PartNote,
} from '../utils/partGen';
import { useSongKey } from './ChordDialog';
import { getAudioEngine } from '../engine/audio';
import { getInstrumentEngine, PRESETS_BY_ID } from '../engine/instruments';
import type { OscillatorTab } from '../engine/oscillator';

/** Where the dialog opens: onto a track, over a range. */
export interface PartDialogInit {
  trackId?: string;
  from?: number;
  to?: number;
}

let opener: ((init: PartDialogInit) => void) | null = null;

/** Open the “Write a part from the chords” dialog. */
export function openPartDialog(init: PartDialogInit = {}): void {
  opener?.(init);
}

/** Mount once; shows the dialog while it's open. */
export function PartDialogHost() {
  const [init, setInit] = useState<PartDialogInit | null>(null);
  useEffect(() => {
    opener = setInit;
    return () => { if (opener === setInit) opener = null; };
  }, []);
  return init ? <PartDialog init={init} onClose={() => setInit(null)} /> : null;
}

/** The kind of part a track's sound suggests. */
function kindFor(track: Track | undefined): PartKind {
  if (!track || track.source.type !== 'preset') return 'bass';
  const cat = getInstrumentEngine().info(track.source.presetId)?.category ?? '';
  if (cat === 'Synth Bass' || cat === 'Bass Guitar') return 'bass';
  if (cat === 'Synth Pluck') return 'arp';
  if (cat === 'Piano' || cat === 'Keys') return 'stabs';
  return 'pad';
}

/** The chords over a range, as text: “Am · F · C · G”, shortened when long. */
function chordsText(chords: ChordMark[], from: number, to: number, flats: boolean): string {
  const names = chordSegments(chords, from, to).map((c) => chordName(c, flats));
  return names.length > 12 ? `${names.slice(0, 12).join(' · ')} …` : names.join(' · ');
}

/** Play the start of a part through a sound, a couple of bars. */
async function audition(source: TrackSource, trackId: string | undefined, patch: Track['patch'] | undefined,
  tabs: OscillatorTab[], notes: PartNote[], from: number, bpm: number, beats: number): Promise<void> {
  const ctx = await getAudioEngine().getOrCreateAudioContext();
  const spb = 60 / bpm;
  const t0 = ctx.currentTime + 0.08;
  const opts = { trackId, patch };
  for (const n of notes) {
    const at = n.startBeat - from;
    if (at < 0) continue;
    if (at >= beats) break;
    const t = t0 + at * spb;
    const d = Math.min(n.durationBeats, beats - at) * spb;
    if (source.type === 'preset') getInstrumentEngine().playNote(source.presetId, n.midiNote, n.velocity, t, d, opts);
    else if (source.type === 'oscillator') {
      const tab = tabs.find((x) => x.id === source.tabId);
      if (tab) getInstrumentEngine().playOscillatorNote(tab.oscillator, tab.advanced, n.midiNote, n.velocity, t, d, opts);
    }
  }
}

/**
 * Write a bass line, pad, arpeggio or stabs from the chord track, over the
 * whole song, a section or the loop, onto a new track or an existing one.
 */
export function PartDialog({ init, onClose }: { init: PartDialogInit; onClose: () => void }) {
  const { state, dispatch } = useAppStore();
  const accent = useAccent();
  const seq = state.sequencer;
  const { key } = useSongKey();
  const flats = keyUsesFlats(key);
  const songEnd = seq.songLengthBars * seq.beatsPerBar;
  const sections = useMemo(() => sectionsFromMarkers(seq.markers, songEnd), [seq.markers, songEnd]);
  const instrumentTracks = seq.tracks.filter((t) => t.source.type !== 'drums');
  const initialTrack = instrumentTracks.find((t) => t.id === init.trackId);

  // Ranges: the whole song, each section, the loop
  const bars = (a: number, b: number) => `bars ${Math.floor(a / seq.beatsPerBar) + 1}–${Math.ceil(b / seq.beatsPerBar)}`;
  const ranges = useMemo(() => {
    const list = [{ id: 'song', label: `Whole song (${bars(0, songEnd)})`, from: 0, to: songEnd }];
    for (const s of sections) list.push({ id: `sec:${s.id}`, label: `${s.name} (${bars(s.beat, s.endBeat)})`, from: s.beat, to: s.endBeat });
    if (seq.loopEnabled && seq.loopEndBeat > seq.loopStartBeat) {
      list.push({ id: 'loop', label: `Loop (${bars(seq.loopStartBeat, seq.loopEndBeat)})`, from: seq.loopStartBeat, to: seq.loopEndBeat });
    }
    return list;
  }, [sections, songEnd, seq.loopEnabled, seq.loopStartBeat, seq.loopEndBeat, seq.beatsPerBar]); // eslint-disable-line react-hooks/exhaustive-deps
  const initialRange = ranges.find((r) => init.from !== undefined && Math.abs(r.from - init.from) < 1e-6 && Math.abs(r.to - (init.to ?? songEnd)) < 1e-6)?.id ?? 'song';

  const [kind, setKind] = useState<PartKind>(kindFor(initialTrack));
  const [styleId, setStyleId] = useState(() => PART_STYLES.find((s) => s.kind === kindFor(initialTrack))!.id);
  const [rangeId, setRangeId] = useState(initialRange);
  const [target, setTarget] = useState<string>(initialTrack?.id ?? 'new');
  const [octave, setOctave] = useState(0);
  const [seed, setSeed] = useState(() => (Date.now() & 0xffff) + 1);

  const style = partStyle(styleId);
  const range = ranges.find((r) => r.id === rangeId) ?? ranges[0];
  const targetTrack = instrumentTracks.find((t) => t.id === target);
  const source: TrackSource = targetTrack?.source ?? { type: 'preset', presetId: style.preset };
  const kindName = PART_KINDS.find((k) => k.kind === kind)!.name;

  const notes = useMemo(
    () => generatePart(seq.chords, { styleId, from: range.from, to: range.to, beatsPerBar: seq.beatsPerBar, seed, octave }),
    [seq.chords, styleId, range.from, range.to, seq.beatsPerBar, seed, octave],
  );
  const chordsInRange = chordsText(seq.chords, range.from, range.to, flats);
  const replaces = targetTrack?.clips.some((c) => c.startBeat < range.to && c.startBeat + c.lengthBeats > range.from) ?? false;

  const pickKind = (k: PartKind) => { setKind(k); setStyleId(PART_STYLES.find((s) => s.kind === k)!.id); };

  const create = () => {
    // One clip per section the range covers, so the part reads like the song
    const cuts = [range.from, ...sections.map((s) => s.beat).filter((b) => b > range.from + 1e-6 && b < range.to - 1e-6), range.to];
    const spans = cuts.slice(0, -1).map((a, i) => ({ start: a, end: cuts[i + 1] }));
    const sectionName = (a: number) => sections.find((s) => a >= s.beat && a < s.endBeat)?.name;
    const parts = splitPart(notes, spans).map((list, i) => ({
      startBeat: spans[i].start,
      lengthBeats: spans[i].end - spans[i].start,
      name: sections.length ? `${kindName} ${sectionName(spans[i].start) ?? ''}`.trim() : kindName,
      notes: list,
    })).filter((p) => p.notes.length);
    if (!parts.length) return;
    const taken = new Set(seq.tracks.map((t) => t.name));
    let name = kindName;
    for (let n = 2; taken.has(name); n++) name = `${kindName} ${n}`;
    dispatch({
      type: 'PART_ADD',
      target: targetTrack ? { trackId: targetTrack.id } : { source, name },
      clips: parts,
    });
    notify(`Wrote ${kindName.toLowerCase() === 'stabs' ? 'stabs' : `a ${kindName.toLowerCase()} part`}: ${notes.length} notes, ${bars(range.from, range.to)}.`);
    onClose();
  };

  const radio = (on: boolean) => `px-2 py-1 text-xs border ${on ? '' : 'border-neutral-700 text-neutral-300 hover:border-neutral-500'}`;
  const onStyle = { borderColor: accent, color: accent, backgroundColor: accent + '18' };
  const select = 'bg-neutral-950 border border-neutral-700 text-xs text-neutral-200 px-1.5 py-1 min-w-0';
  const firstNote = notes[0]?.startBeat ?? range.from;
  const previewFrom = Math.max(range.from, Math.floor(firstNote / seq.beatsPerBar) * seq.beatsPerBar);

  return (
    <Dialog title="Write a part from the chords" onClose={onClose} className="w-[600px]">
      <div className="px-4 py-3 space-y-3 text-xs text-neutral-400">
        <div role="radiogroup" aria-label="Part" className="flex gap-1">
          {PART_KINDS.map((k) => (
            <button key={k.kind} role="radio" aria-checked={kind === k.kind} className={`flex-1 ${radio(kind === k.kind)}`}
              style={kind === k.kind ? onStyle : undefined} onClick={() => pickKind(k.kind)}>{k.name}</button>
          ))}
        </div>

        <div role="radiogroup" aria-label="Style" className="grid grid-cols-2 gap-1">
          {PART_STYLES.filter((s) => s.kind === kind).map((s) => (
            <button key={s.id} role="radio" aria-checked={styleId === s.id}
              className={`text-left ${radio(styleId === s.id)}`} style={styleId === s.id ? onStyle : undefined}
              onClick={() => setStyleId(s.id)}>
              <span className="block text-neutral-100">{s.name}</span>
              <span className="block text-neutral-500">{s.hint}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-center">
          <label htmlFor="part-range">Where</label>
          <select id="part-range" className={select} value={range.id} onChange={(e) => setRangeId(e.target.value)}>
            {ranges.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <label htmlFor="part-target">Onto</label>
          <select id="part-target" className={select} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="new">A new track — {PRESETS_BY_ID.get(style.preset)?.name ?? 'instrument'}</option>
            {instrumentTracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <label htmlFor="part-octave">Register</label>
          <select id="part-octave" className={select} value={octave} onChange={(e) => setOctave(+e.target.value)}>
            <option value={-1}>An octave lower</option>
            <option value={0}>Usual for a {kindName.toLowerCase()}</option>
            <option value={1}>An octave higher</option>
          </select>
        </div>

        {chordsInRange ? (
          <p aria-live="polite">
            Over <span className="text-neutral-200">{chordsInRange}</span> — {notes.length} notes.
            {replaces && <span className="text-amber-300"> Replaces what {targetTrack!.name} has there.</span>}
          </p>
        ) : (
          <p role="alert" className="text-amber-300">
            There are no chords there yet. Right-click the chord row on the ruler to detect them from the notes or fill in a progression.
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 px-4 pb-4">
        <Button disabled={!notes.length}
          onClick={() => void audition(source, targetTrack?.id, targetTrack?.patch, state.tabs, notes, previewFrom, seq.bpm, seq.beatsPerBar * 2)}>
          ▶ Hear it
        </Button>
        <Button onClick={() => setSeed((s) => s + 1)} disabled={!notes.length} title="The same style with different small choices">Another take</Button>
        <span className="ml-auto" />
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!notes.length} onClick={create}>Write it</Button>
      </div>
    </Dialog>
  );
}
