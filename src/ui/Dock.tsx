import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAppStore, useAccent, findClip } from '../store/appStore';
import { useDrumStore } from '../store/drumStore';
import { PianoRoll } from '../sequencer/PianoRoll';
import { ClipSidebar } from '../sequencer/TrackHeader';
import { Mixer } from '../sequencer/Mixer';
import { DrumMachine } from '../sampler/DrumMachine';
import { InstrumentLibrary } from '../sampler/InstrumentLibrary';
import { EffectsPanel } from '../sampler/EffectsPanel';
import { SNAP_OPTIONS, type SnapValue } from '../utils/music';
import { setFocusZone } from './focus';
import { isMac, withShortcut } from './shortcuts';

export type DockTab = 'editor' | 'mixer' | 'instruments' | 'fx';

const TABS: { id: DockTab; label: string; name: string }[] = [
  { id: 'editor', label: 'EDITOR', name: 'Editor' },
  { id: 'mixer', label: 'MIXER', name: 'Mixer' },
  { id: 'instruments', label: 'INSTRUMENTS', name: 'Instrument library' },
  { id: 'fx', label: 'FX', name: 'Master effects' },
];

interface Props {
  tab: DockTab;
  onTab: (t: DockTab) => void;
  height: number;
  onHeight: (h: number) => void;
  collapsed: boolean;
  onCollapsed: (c: boolean) => void;
  onSeek: (beat: number) => void;
}

/**
 * Bottom panel, following the arrange-above/editor-below split of Ableton's
 * detail view and Logic's editors area. Drag its top edge to resize; click the
 * active tab to collapse it.
 */
export function Dock({ tab, onTab, height, onHeight, collapsed, onCollapsed, onSeek }: Props) {
  const accent = useAccent();
  const dragRef = useRef<{ y: number; h: number } | null>(null);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { y: e.clientY, h: height };
    if (collapsed) onCollapsed(false);
    const move = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const h = dragRef.current.h - (ev.clientY - dragRef.current.y);
      onHeight(Math.max(140, Math.min(window.innerHeight - 220, h)));
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div
      className="flex flex-col shrink-0 border-t border-neutral-700 bg-[var(--surface-1)]"
      style={{ height: collapsed ? 28 : height }}
      onMouseDown={() => setFocusZone(tab === 'editor' ? 'editor' : 'other')}
    >
      <div
        className="h-1 -mt-0.5 cursor-row-resize hover:bg-neutral-600 transition-colors shrink-0"
        onMouseDown={startResize}
        title="Drag to resize"
      />
      <div className="flex items-center gap-0.5 px-2 shrink-0 border-b border-neutral-800 bg-neutral-900/60" role="tablist">
        {TABS.map((t) => {
          const active = t.id === tab && !collapsed;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => {
                if (t.id === tab) onCollapsed(!collapsed);
                else { onTab(t.id); onCollapsed(false); }
              }}
              className="px-3 py-1 text-xs tracking-widest border-b-2 transition-colors"
              style={active
                ? { borderColor: accent, color: accent }
                : { borderColor: 'transparent', color: 'var(--color-neutral-500)' }}
              title={withShortcut(t.name, `view.${t.id}`)}
            >{t.label}</button>
          );
        })}
        <span className="ml-auto text-neutral-500" style={{ fontSize: 11 }}>
          {collapsed ? 'click a tab to open' : 'click the open tab to collapse'}
        </span>
      </div>
      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-hidden">
          {tab === 'editor' && <EditorPanel onSeek={onSeek} />}
          {tab === 'mixer' && <Mixer />}
          {tab === 'instruments' && <InstrumentLibrary />}
          {tab === 'fx' && <div className="h-full overflow-y-auto"><EffectsPanel /></div>}
        </div>
      )}
    </div>
  );
}

// ─── Editor ───────────────────────────────────────────────────────────────────

function EditorPanel({ onSeek }: { onSeek: (beat: number) => void }) {
  const { state, dispatch } = useAppStore();
  const { state: drumState, dispatch: drumDispatch } = useDrumStore();
  const seq = state.sequencer;
  const containerRef = useRef<HTMLDivElement>(null);

  const found = findClip(seq, seq.selectedClipId);
  const track = found?.track ?? seq.tracks.find((t) => t.id === seq.selectedTrackId) ?? null;
  const clip = found?.clip ?? null;
  const isDrums = track?.source.type === 'drums';

  const usedBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of seq.tracks) for (const c of t.clips) m.set(c.patternId, (m.get(c.patternId) ?? 0) + 1);
    return m;
  }, [seq.tracks]);

  // Keep the drum editor and the selected drum clip pointing at the same
  // pattern: selecting a clip shows its pattern; picking a pattern in the
  // editor swaps it into the clip.
  const drumClip = isDrums && clip ? clip : null;
  useEffect(() => {
    if (drumClip && drumState.activePatternId !== drumClip.patternId &&
        drumState.patterns.some((p) => p.id === drumClip.patternId)) {
      drumDispatch({ type: 'DRUM_SET_ACTIVE_PATTERN', id: drumClip.patternId });
    }
  }, [drumClip?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastActive = useRef(drumState.activePatternId);
  useEffect(() => {
    const changed = lastActive.current !== drumState.activePatternId;
    lastActive.current = drumState.activePatternId;
    if (changed && drumClip && drumClip.patternId !== drumState.activePatternId) {
      dispatch({ type: 'SEQ_PUSH_UNDO' });
      dispatch({ type: 'CLIP_SET_PATTERN', clipId: drumClip.id, patternId: drumState.activePatternId });
    }
  }, [drumState.activePatternId]); // eslint-disable-line react-hooks/exhaustive-deps

  const height = useEditorHeight(containerRef);

  if (!track) {
    return <Empty>Add a track in the arrangement to start writing.</Empty>;
  }

  if (isDrums) {
    const label = clip ? `${track.name} · bar ${Math.floor(clip.startBeat / seq.beatsPerBar) + 1}` : undefined;
    return <DrumMachine usedBy={usedBy} boundClipLabel={label} />;
  }

  const pattern = clip ? seq.patterns[clip.patternId] : undefined;
  if (!clip || !pattern) {
    return (
      <Empty>
        <span className="text-neutral-300">{track.name}</span> has no clip selected.{' '}
        Double-click its lane in the arrangement to create one, or click an existing clip to edit it.
      </Empty>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <EditorToolbar />
      <div ref={containerRef} className="flex flex-1 min-h-0">
        <ClipSidebar track={track} clip={clip} pattern={pattern} uses={usedBy.get(pattern.id) ?? 1} />
        <div className="flex-1 min-w-0">
          <PianoRoll track={track} clip={clip} pattern={pattern} height={height} onSeek={onSeek} />
        </div>
      </div>
    </div>
  );
}

/** Height of the editor area, tracked with a ResizeObserver as the dock resizes. */
function useEditorHeight(ref: React.RefObject<HTMLDivElement | null>): number {
  const [h, setH] = useState(260);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  });
  return Math.max(120, h);
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex items-center justify-center px-6 text-xs text-neutral-500 text-center leading-relaxed">
      <div>{children}</div>
    </div>
  );
}

function EditorToolbar() {
  const { state, dispatch } = useAppStore();
  const accent = useAccent();
  const seq = state.sequencer;
  const found = findClip(seq, seq.selectedClipId);
  const patternId = found?.clip.patternId;
  const off = 'border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-neutral-200';
  const on = { borderColor: accent, color: accent, backgroundColor: accent + '18' };

  return (
    <div className="flex items-center gap-2 px-2 py-1 border-b border-neutral-800 bg-neutral-900/40 shrink-0 flex-wrap">
      <div className="flex gap-0.5">
        {(['draw', 'select'] as const).map((m) => (
          <button
            key={m}
            onClick={() => dispatch({ type: 'SEQ_SET_EDIT_MODE', mode: m })}
            className={`px-2 py-0.5 text-xs border tracking-widest ${seq.editMode === m ? '' : off}`}
            style={seq.editMode === m ? on : {}}
            title={m === 'draw' ? withShortcut('Draw: click to add notes', 'editor.draw') : withShortcut('Select: drag a box to select', 'editor.select')}
          >{m === 'draw' ? '✎ DRAW' : '⬚ SELECT'}</button>
        ))}
      </div>
      <label className="flex items-center gap-1 text-xs text-neutral-500" title="Note grid (hold Shift to ignore it)">
        GRID
        <select value={seq.snapValue} onChange={(e) => dispatch({ type: 'SEQ_SET_SNAP', snap: e.target.value as SnapValue })}
          className="bg-neutral-950 border border-neutral-700 text-neutral-200 px-1 py-0.5">
          {SNAP_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs text-neutral-500" title="Length of newly drawn notes">
        NOTE
        <select value={seq.defaultNoteLength} onChange={(e) => dispatch({ type: 'SEQ_SET_DEFAULT_NOTE_LEN', len: e.target.value as SnapValue })}
          className="bg-neutral-950 border border-neutral-700 text-neutral-200 px-1 py-0.5">
          {SNAP_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <button
        onClick={() => dispatch({ type: 'SEQ_TOGGLE_VELOCITY_LANE' })}
        className={`px-2 py-0.5 text-xs border tracking-widest ${seq.showVelocityLane ? '' : off}`}
        style={seq.showVelocityLane ? on : {}}
        title="Velocity lane"
      >VEL</button>
      <button
        onClick={() => { if (patternId) { dispatch({ type: 'SEQ_PUSH_UNDO' }); dispatch({ type: 'SEQ_QUANTIZE', patternId }); } }}
        disabled={!seq.selectedNoteIds.length}
        className={`px-2 py-0.5 text-xs border ${off} disabled:opacity-30 disabled:pointer-events-none`}
        title={withShortcut('Quantize selected notes to the grid', 'editor.quantize')}
      >Q</button>
      <span className="ml-auto text-neutral-500" style={{ fontSize: 11 }}>
        click keys or type A–; to audition · right-click deletes · ↑↓ transpose · {isMac() ? '⌘' : 'Ctrl'}+wheel zoom · Shift+wheel pitch
      </span>
    </div>
  );
}
