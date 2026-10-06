import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { SNAP_OPTIONS, ARP_MODES } from '../utils/music';
import type { Track, Pattern, Clip, SnapValue, ArpMode } from '../utils/music';

interface Props {
  track: Track;
  clip: Clip;
  pattern: Pattern;
  /** How many clips play this pattern. */
  uses: number;
}

const SIDEBAR_W = 196;

/** Left column of the note editor: the pattern being edited and the track's arpeggiator. */
export function ClipSidebar({ track, clip, pattern, uses }: Props) {
  const { state, dispatch } = useAppStore();
  const seq = state.sequencer;
  const arp = track.arp;
  const [name, setName] = useState(pattern.name);
  useEffect(() => setName(pattern.name), [pattern.name]);

  const bars = pattern.lengthBeats / seq.beatsPerBar;
  const label = 'text-neutral-600 tracking-widest';

  return (
    <div
      className="shrink-0 flex flex-col gap-2 px-2.5 py-2 border-r border-neutral-800 bg-[#101010] overflow-y-auto"
      style={{ width: SIDEBAR_W }}
    >
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: track.color }} />
        <span className="text-xs text-neutral-300 truncate">{track.name}</span>
      </div>

      <label className="flex flex-col gap-0.5">
        <span className={label} style={{ fontSize: 9 }}>PATTERN</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => dispatch({ type: 'PATTERN_RENAME', patternId: pattern.id, name })}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="bg-neutral-950 border border-neutral-700 text-xs text-neutral-200 px-1.5 py-0.5 focus:outline-hidden focus:border-neutral-500"
        />
      </label>

      <label className="flex items-center justify-between gap-1" title="Pattern loop length — a longer clip repeats it">
        <span className={label} style={{ fontSize: 9 }}>LOOP</span>
        <select
          value={Number.isInteger(bars) ? String(bars) : 'custom'}
          onChange={(e) => {
            if (e.target.value === 'custom') return;
            dispatch({ type: 'SEQ_PUSH_UNDO' });
            dispatch({ type: 'PATTERN_SET_LENGTH', patternId: pattern.id, lengthBeats: parseFloat(e.target.value) * seq.beatsPerBar });
          }}
          className="bg-neutral-950 border border-neutral-700 text-xs text-neutral-200 px-1 py-0.5"
        >
          {!Number.isInteger(bars) && <option value="custom">{pattern.lengthBeats} beats</option>}
          {[1, 2, 4, 8, 16, 32].map((b) => <option key={b} value={b}>{b} bar{b > 1 ? 's' : ''}</option>)}
        </select>
      </label>

      <div className="text-neutral-600 leading-snug" style={{ fontSize: 10 }}>
        {pattern.notes.length} note{pattern.notes.length === 1 ? '' : 's'}
        {uses > 1 && (
          <>
            {' · '}
            <span className="text-amber-400" title="Edits here change every linked clip">linked to {uses} clips</span>
            <button
              onClick={() => { dispatch({ type: 'SEQ_PUSH_UNDO' }); dispatch({ type: 'CLIP_MAKE_UNIQUE', clipId: clip.id }); }}
              className="ml-1 underline hover:text-neutral-300"
            >make unique</button>
          </>
        )}
      </div>

      <button
        onClick={() => {
          if (!pattern.notes.length) return;
          dispatch({ type: 'SEQ_PUSH_UNDO' });
          dispatch({ type: 'SEQ_CLEAR_PATTERN', patternId: pattern.id });
        }}
        disabled={!pattern.notes.length}
        className="self-start px-1.5 py-0.5 text-[10px] border border-neutral-700 text-neutral-500 hover:text-red-400 hover:border-red-900 disabled:opacity-30"
      >CLEAR NOTES</button>

      {/* Arpeggiator — a track setting, so it applies to every clip on the track */}
      <div
        className="mt-1 pt-2 border-t border-neutral-800 flex flex-col gap-1.5"
        style={{ backgroundColor: arp.enabled ? track.color + '0c' : undefined }}
      >
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => dispatch({ type: 'SEQ_SET_ARP', trackId: track.id, arp: { enabled: !arp.enabled } })}
            className="px-1.5 py-0.5 text-xs border tracking-widest"
            style={arp.enabled
              ? { borderColor: track.color, color: track.color, backgroundColor: track.color + '22' }
              : { borderColor: '#404040', color: '#737373' }}
            title="Turn held chords into an arpeggio (applies to the whole track)"
            aria-pressed={arp.enabled}
          >ARP</button>
          <span className="text-neutral-600" style={{ fontSize: 9 }}>track-wide</span>
        </div>
        {arp.enabled && (
          <>
            <div className="flex gap-1">
              <select
                value={arp.rate}
                onChange={(e) => dispatch({ type: 'SEQ_SET_ARP', trackId: track.id, arp: { rate: e.target.value as SnapValue } })}
                className="bg-neutral-950 border border-neutral-700 text-xs text-neutral-300 px-0.5"
                title="Step length"
              >
                {SNAP_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <select
                value={arp.mode}
                onChange={(e) => dispatch({ type: 'SEQ_SET_ARP', trackId: track.id, arp: { mode: e.target.value as ArpMode } })}
                className="flex-1 min-w-0 bg-neutral-950 border border-neutral-700 text-xs text-neutral-300 px-0.5"
                title="Direction"
              >
                {ARP_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-1.5 text-neutral-500" style={{ fontSize: 10 }}>
              <span className="w-9">OCT {arp.octaves}</span>
              <input type="range" min={1} max={4} step={1} value={arp.octaves} className="flex-1 h-1"
                style={{ accentColor: track.color }}
                onChange={(e) => dispatch({ type: 'SEQ_SET_ARP', trackId: track.id, arp: { octaves: +e.target.value } })} />
            </label>
            <label className="flex items-center gap-1.5 text-neutral-500" style={{ fontSize: 10 }}>
              <span className="w-9">GATE</span>
              <input type="range" min={0.05} max={1} step={0.05} value={arp.gate} className="flex-1 h-1"
                style={{ accentColor: track.color }}
                onChange={(e) => dispatch({ type: 'SEQ_SET_ARP', trackId: track.id, arp: { gate: +e.target.value } })} />
            </label>
          </>
        )}
      </div>
    </div>
  );
}
