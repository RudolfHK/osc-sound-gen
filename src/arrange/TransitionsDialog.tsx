import { useEffect, useMemo, useState } from 'react';
import { useAppStore, useAccent, type TrackWrite } from '../store/appStore';
import { useDrumStore, type DrumPattern } from '../store/drumStore';
import { requestUndoStep } from '../store/history';
import { Dialog } from '../ui/kit/Dialog';
import { Button } from '../ui/kit/Button';
import { notify } from '../ui/notices';
import { sectionsFromMarkers, type Track } from '../utils/music';
import { makeRoll } from '../utils/drumGen';
import { leadIn, planImpacts, planRisers } from '../utils/transitions';

const RISER_PRESET = 'fx-noise-sweep';
const IMPACT_PRESET = 'fx-impact';

let opener: ((only?: string) => void) | null = null;

/** Open the transitions dialog, optionally for one section (its marker id). */
export function openTransitionsDialog(onlySection?: string): void {
  opener?.(onlySection);
}

/** Mount once; shows the dialog while it's open. */
export function TransitionsDialogHost() {
  const [open, setOpen] = useState<{ only?: string } | null>(null);
  useEffect(() => {
    const fn = (only?: string) => setOpen({ only });
    opener = fn;
    return () => { if (opener === fn) opener = null; };
  }, []);
  return open ? <TransitionsDialog only={open.only} onClose={() => setOpen(null)} /> : null;
}

/** An existing track playing this preset, to reuse. */
const trackWithPreset = (tracks: Track[], presetId: string) =>
  tracks.find((t) => t.source.type === 'preset' && t.source.presetId === presetId);

/**
 * Risers, snare rolls and impacts into the song's sections, written as one
 * undo step: risers and impacts on their own tracks (reused if the song
 * already has them), rolls into the drum track's bars before each section.
 */
export function TransitionsDialog({ only, onClose }: { only?: string; onClose: () => void }) {
  const { state, dispatch } = useAppStore();
  const { state: drumState, dispatch: drumDispatch } = useDrumStore();
  const accent = useAccent();
  const seq = state.sequencer;
  const bar = seq.beatsPerBar;
  const songEnd = seq.songLengthBars * bar;
  const sections = useMemo(() => sectionsFromMarkers(seq.markers, songEnd), [seq.markers, songEnd]);
  const targets = sections.filter((s) => s.beat > 1e-6);
  const drumTracks = seq.tracks.filter((t) => t.source.type === 'drums');

  const [chosen, setChosen] = useState<Set<string>>(() => new Set(targets.filter((s) => !only || s.id === only).map((s) => s.id)));
  const [riser, setRiser] = useState(true);
  const [riserBars, setRiserBars] = useState(2);
  const [roll, setRoll] = useState(drumTracks.length > 0);
  const [rollBars, setRollBars] = useState(1);
  const [drumTrackId, setDrumTrackId] = useState(drumTracks[0]?.id ?? '');
  const [impact, setImpact] = useState(true);

  const picked = targets.filter((s) => chosen.has(s.id));
  const beats = picked.map((s) => s.beat);
  const starts = sections.map((s) => s.beat);
  const drumTrack = drumTracks.find((t) => t.id === drumTrackId);
  const nothing = !picked.length || (!riser && !(roll && drumTrack) && !impact);
  const barOf = (beat: number) => Math.floor(beat / bar) + 1;

  const apply = () => {
    // Snare rolls: a pattern per section, built on the groove playing there
    const patterns = new Map(drumState.patterns.map((p) => [p.id, p]));
    const rolls: { start: number; end: number; pattern: DrumPattern }[] = [];
    if (roll && drumTrack) {
      for (const s of picked) {
        const start = leadIn(starts, s.beat, rollBars * bar);
        if (s.beat - start < 1) continue;
        const clip = drumTrack.clips.find((c) => c.startBeat <= start + 1e-6 && start < c.startBeat + c.lengthBeats - 1e-6);
        const base = clip ? patterns.get(clip.patternId) ?? null : null;
        rolls.push({
          start, end: s.beat,
          pattern: makeRoll(base, { bars: Math.round((s.beat - start) / bar) || 1, barSteps: Math.min(16, bar * 4), name: `Roll into ${s.name}` }),
        });
      }
    }
    const writes: TrackWrite[] = [];
    if (riser) {
      const plan = planRisers(beats, starts, bar, riserBars);
      const spans = plan.clips.map((c) => ({ from: c.startBeat, to: c.startBeat + c.lengthBeats }));
      const existing = trackWithPreset(seq.tracks, RISER_PRESET);
      if (plan.clips.length) {
        writes.push({
          target: existing ? { trackId: existing.id } : { source: { type: 'preset', presetId: RISER_PRESET }, name: 'Risers' },
          clips: plan.clips,
          lanes: [
            { target: 'cutoff', points: plan.cutoff, spans },
            { target: 'volume', points: plan.volume, spans },
          ],
        });
      }
    }
    if (impact) {
      const clips = planImpacts(beats, starts, bar, songEnd);
      const existing = trackWithPreset(seq.tracks, IMPACT_PRESET);
      if (clips.length) {
        writes.push({ target: existing ? { trackId: existing.id } : { source: { type: 'preset', presetId: IMPACT_PRESET }, name: 'Impacts' }, clips });
      }
    }
    if (!rolls.length && !writes.length) return;

    // One undo step for both stores: the drum patterns' step key is taken first
    requestUndoStep(rolls.length ? `drum-add:${rolls[0].pattern.id}` : null, 'Add transitions');
    if (rolls.length) {
      drumDispatch({ type: 'DRUM_ADD_PATTERNS', patterns: rolls.map((r) => r.pattern) });
      for (const r of rolls) {
        dispatch({ type: 'CLIP_REPLACE_RANGE', trackId: drumTrack!.id, startBeat: r.start, endBeat: r.end, patternId: r.pattern.id });
      }
    }
    if (writes.length) dispatch({ type: 'TRACKS_WRITE', writes });
    const what = [
      riser && 'risers', rolls.length && 'snare rolls', impact && 'impacts',
    ].filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' and $1');
    notify(`Added ${what} into ${picked.length} section${picked.length === 1 ? '' : 's'}.`, 'info',
      { label: 'Undo', run: () => dispatch({ type: 'SEQ_UNDO' }) });
    onClose();
  };

  const select = 'bg-neutral-950 border border-neutral-700 text-xs text-neutral-200 px-1.5 py-1';
  const check = { accentColor: accent };

  return (
    <Dialog title="Add transitions" onClose={onClose} className="w-[520px]">
      <div className="px-4 py-3 space-y-3 text-xs text-neutral-400">
        {targets.length === 0 ? (
          <p role="alert" className="text-amber-300">
            Transitions lead into sections, and this song has only one. Double-click the top row of the ruler to add sections (Verse, Chorus, Drop…).
          </p>
        ) : (
          <fieldset>
            <legend className="text-[11px] tracking-widest text-neutral-500 mb-1">INTO</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {targets.map((s) => (
                <label key={s.id} className="flex items-center gap-1.5">
                  <input type="checkbox" style={check} checked={chosen.has(s.id)}
                    onChange={(e) => setChosen((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(s.id); else next.delete(s.id);
                      return next;
                    })} />
                  <span className="text-neutral-200">{s.name}</span>
                  <span className="text-neutral-500">bar {barOf(s.beat)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-center">
          <legend className="text-[11px] tracking-widest text-neutral-500 mb-1">WHAT</legend>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" style={check} checked={riser} onChange={(e) => setRiser(e.target.checked)} />
            Riser
          </label>
          <span className="flex items-center gap-2">
            <select aria-label="Riser length" className={select} value={riserBars} onChange={(e) => setRiserBars(+e.target.value)} disabled={!riser}>
              {[1, 2, 4, 8].map((n) => <option key={n} value={n}>{n} bar{n > 1 ? 's' : ''}</option>)}
            </select>
            <span className="text-neutral-500">a noise sweep that opens up into the downbeat</span>
          </span>

          <label className="flex items-center gap-1.5">
            <input type="checkbox" style={check} checked={roll && !!drumTrack} disabled={!drumTracks.length} onChange={(e) => setRoll(e.target.checked)} />
            Snare roll
          </label>
          <span className="flex items-center gap-2 flex-wrap">
            <select aria-label="Snare roll length" className={select} value={rollBars} onChange={(e) => setRollBars(+e.target.value)} disabled={!roll || !drumTrack}>
              <option value={1}>1 bar</option>
              <option value={2}>2 bars</option>
            </select>
            {drumTracks.length > 1 && (
              <select aria-label="Drum track" className={select} value={drumTrackId} onChange={(e) => setDrumTrackId(e.target.value)} disabled={!roll}>
                {drumTracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            <span className="text-neutral-500">{drumTracks.length ? 'replaces the drums in those bars, keeping the kick' : 'needs a drum track'}</span>
          </span>

          <label className="flex items-center gap-1.5">
            <input type="checkbox" style={check} checked={impact} onChange={(e) => setImpact(e.target.checked)} />
            Impact
          </label>
          <span className="text-neutral-500">a hit with a sub drop on the section’s first beat</span>
        </fieldset>

        <p className="text-neutral-500">
          Risers and impacts go on their own tracks ({trackWithPreset(seq.tracks, RISER_PRESET) || trackWithPreset(seq.tracks, IMPACT_PRESET) ? 'the ones the song already has' : 'added for you'}), so you can mix or mute them. One undo takes it all back.
        </p>
      </div>

      <div className="flex items-center gap-2 px-4 pb-4">
        <span className="ml-auto" />
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={nothing} onClick={apply}>Add transitions</Button>
      </div>
    </Dialog>
  );
}
