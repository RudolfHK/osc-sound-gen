import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAppStore, useAccent, findClip } from '../store/appStore';
import { useDrumStore } from '../store/drumStore';
import { PRESETS_BY_ID } from '../engine/instruments';
import { AUTOMATION_TARGETS, AUTOMATION_TARGET_LIST } from '../engine/automation';
import { getPlayhead, subscribePlayhead } from '../engine/playhead';
import { AutomationCanvas } from '../sequencer/AutomationLane';
import { ContextMenu, type MenuItem } from '../ui/ContextMenu';
import { setFocusZone } from '../ui/focus';
import { Ruler } from './Ruler';
import { drawLane } from './drawLane';
import {
  HEADER_W, TRACK_H, AUTO_H, RULER_H, EDGE_PX,
  beatToX, xToBeat, snapTo, arrangeGrid, type ArrView,
} from './geometry';
import {
  sectionsFromMarkers, TRACK_COLORS, uid,
  type AutomationTarget, type Clip, type Track,
} from '../utils/music';
import type { DockTab } from '../ui/Dock';

interface Props {
  onSeek: (beat: number) => void;
  openDock: (tab: DockTab) => void;
}

type Drag =
  | { kind: 'move'; clipId: string; grabOffset: number; origStart: number; origTrack: string; moved: boolean; downX: number }
  | { kind: 'resize-r'; clipId: string; start: number; offset: number }
  | { kind: 'resize-l'; clipId: string; end: number; origStart: number; origOffset: number };

// ─── Source label ─────────────────────────────────────────────────────────────

export function sourceLabel(track: Track, tabs: { id: string; label: string }[]): string {
  const s = track.source;
  if (s.type === 'drums') return 'Drum kit';
  if (s.type === 'oscillator') return `Oscillator · ${tabs.find((t) => t.id === s.tabId)?.label ?? 'missing'}`;
  return PRESETS_BY_ID.get(s.presetId)?.name ?? s.presetId;
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function ArrangementView({ onSeek, openDock }: Props) {
  const { state, dispatch } = useAppStore();
  const { state: drumState } = useDrumStore();
  const accent = useAccent();
  const seq = state.sequencer;

  const lanesRef = useRef<HTMLDivElement>(null);
  const [laneW, setLaneW] = useState(800);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; title?: string } | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const view: ArrView = useMemo(
    () => ({ startBeat: seq.arrStartBeat, pxPerBeat: seq.arrPxPerBeat }),
    [seq.arrStartBeat, seq.arrPxPerBeat],
  );
  const grid = arrangeGrid(seq);
  const songEnd = seq.songLengthBars * seq.beatsPerBar;
  const sections = useMemo(() => sectionsFromMarkers(seq.markers, songEnd), [seq.markers, songEnd]);
  const drumPatterns = useMemo(() => new Map(drumState.patterns.map((p) => [p.id, p])), [drumState.patterns]);
  const patternUse = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of seq.tracks) for (const c of t.clips) m.set(c.patternId, (m.get(c.patternId) ?? 0) + 1);
    return m;
  }, [seq.tracks]);
  const anySolo = seq.tracks.some((t) => t.solo);

  // The patterns each lane draws. A lane redraws when one of its own patterns
  // changes — editing a note on one track no longer repaints every lane.
  const lanePatternsRef = useRef(new Map<string, unknown[]>());
  const lanePatterns = useMemo(() => {
    const out = new Map<string, unknown[]>();
    for (const t of seq.tracks) {
      const list = t.clips.map((c) => (t.source.type === 'drums' ? drumPatterns.get(c.patternId) : seq.patterns[c.patternId]));
      const prev = lanePatternsRef.current.get(t.id);
      out.set(t.id, prev && prev.length === list.length && prev.every((p, i) => p === list[i]) ? prev : list);
    }
    lanePatternsRef.current = out;
    return out;
  }, [seq.tracks, seq.patterns, drumPatterns]);

  // Lanes column width drives every canvas
  useLayoutEffect(() => {
    const el = lanesRef.current;
    if (!el) return;
    const update = () => setLaneW(Math.max(100, el.clientWidth - HEADER_W));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Wheel: vertical scrolls natively; Shift/trackpad-x scrolls time; Ctrl zooms ──
  useEffect(() => {
    const el = lanesRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left - HEADER_W;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // Zoom around the cursor so what you point at stays put
        const anchor = xToBeat(Math.max(0, x), viewRef.current);
        const px = Math.max(3, Math.min(160, viewRef.current.pxPerBeat * (e.deltaY > 0 ? 0.85 : 1.18)));
        dispatch({ type: 'SEQ_SET_ARR_VIEW', pxPerBeat: px, startBeat: Math.max(0, anchor - Math.max(0, x) / px) });
      } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        const delta = (e.shiftKey ? e.deltaY : e.deltaX) / viewRef.current.pxPerBeat;
        dispatch({ type: 'SEQ_SET_ARR_VIEW', startBeat: Math.max(0, viewRef.current.startBeat + delta) });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [dispatch]);

  const viewRef = useRef(view);
  viewRef.current = view;
  const seqRef = useRef(seq);
  seqRef.current = seq;

  // ── Clip gestures ──
  const trackAtPoint = (clientX: number, clientY: number): string | null => {
    const el = document.elementFromPoint(clientX, clientY)?.closest('[data-lane-track]');
    return el?.getAttribute('data-lane-track') ?? null;
  };

  // Deliberately not memoized: it calls helpers that read the current drum
  // patterns and clip-link counts, which a stale closure would get wrong.
  const onLaneMouseDown = (track: Track, e: React.MouseEvent<HTMLCanvasElement>) => {
    setFocusZone('arrange');
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const beat = Math.max(0, xToBeat(x, viewRef.current));
    const clip = clipAt(track, beat);

    if (e.button === 2) {
      if (clip) {
        dispatch({ type: 'CLIP_SELECT', clipId: clip.id });
        setMenu(clipMenu(track, clip, e.clientX, e.clientY, beat));
      } else {
        dispatch({ type: 'TRACK_SELECT', trackId: track.id });
        setMenu({
          x: e.clientX, y: e.clientY, title: track.name,
          items: [{ label: 'Create clip here', onSelect: () => createClip(track, beat) }],
        });
      }
      return;
    }
    if (e.button !== 0) return;

    if (!clip) {
      dispatch({ type: 'TRACK_SELECT', trackId: track.id });
      dispatch({ type: 'CLIP_SELECT', clipId: null });
      return;
    }

    dispatch({ type: 'SEQ_PUSH_UNDO' });
    const xs = beatToX(clip.startBeat, viewRef.current);
    const xe = beatToX(clip.startBeat + clip.lengthBeats, viewRef.current);
    if (Math.abs(x - xe) <= EDGE_PX && xe - xs > EDGE_PX * 2) {
      dispatch({ type: 'CLIP_SELECT', clipId: clip.id });
      dragRef.current = { kind: 'resize-r', clipId: clip.id, start: clip.startBeat, offset: clip.offsetBeats };
      return;
    }
    if (Math.abs(x - xs) <= EDGE_PX && xe - xs > EDGE_PX * 2) {
      dispatch({ type: 'CLIP_SELECT', clipId: clip.id });
      dragRef.current = {
        kind: 'resize-l', clipId: clip.id,
        end: clip.startBeat + clip.lengthBeats, origStart: clip.startBeat, origOffset: clip.offsetBeats,
      };
      return;
    }

    // Alt-drag copies, the convention in every major DAW
    let id = clip.id;
    if (e.altKey) {
      id = uid('clip');
      dispatch({ type: 'CLIP_DUPLICATE', clipId: clip.id, newId: id });
      dispatch({ type: 'CLIP_MOVE', clipId: id, trackId: track.id, startBeat: clip.startBeat });
    }
    dispatch({ type: 'CLIP_SELECT', clipId: id });
    dragRef.current = {
      kind: 'move', clipId: id, grabOffset: beat - clip.startBeat,
      origStart: clip.startBeat, origTrack: track.id, moved: false, downX: e.clientX,
    };
  };

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragRef.current;
      const el = lanesRef.current;
      if (!d || !el) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left - HEADER_W;
      const beat = xToBeat(x, viewRef.current);
      const free = e.shiftKey;
      const g = arrangeGrid(seqRef.current);
      const found = findClip(seqRef.current, d.clipId);
      if (!found) return;

      if (d.kind === 'move') {
        if (!d.moved && Math.abs(e.clientX - d.downX) < 3) return;
        d.moved = true;
        const start = Math.max(0, snapTo(beat - d.grabOffset, g, free));
        const target = trackAtPoint(e.clientX, e.clientY) ?? found.track.id;
        if (start !== found.clip.startBeat || target !== found.track.id) {
          dispatch({ type: 'CLIP_MOVE', clipId: d.clipId, trackId: target, startBeat: start });
        }
      } else if (d.kind === 'resize-r') {
        const end = Math.max(d.start + Math.min(g, 0.25), snapTo(beat, g, free));
        dispatch({ type: 'CLIP_RESIZE', clipId: d.clipId, startBeat: d.start, lengthBeats: end - d.start, offsetBeats: d.offset });
      } else {
        // Trimming the left edge reveals or hides the start of the pattern
        const minStart = Math.max(0, d.origStart - d.origOffset);
        const start = Math.max(minStart, Math.min(d.end - 0.25, snapTo(beat, g, free)));
        dispatch({
          type: 'CLIP_RESIZE', clipId: d.clipId,
          startBeat: start, lengthBeats: d.end - start, offsetBeats: d.origOffset + (start - d.origStart),
        });
      }
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dispatch]);

  const createClip = useCallback((track: Track, beat: number) => {
    const s = seqRef.current;
    const g = arrangeGrid(s);
    const start = Math.max(0, Math.floor(beat / g) * g);
    dispatch({ type: 'SEQ_PUSH_UNDO' });
    if (track.source.type === 'drums') {
      const dp = drumPatterns.get(drumState.activePatternId) ?? drumState.patterns[0];
      if (!dp) return;
      dispatch({ type: 'CLIP_ADD', trackId: track.id, startBeat: start, lengthBeats: dp.stepCount * 0.25, patternId: dp.id });
    } else {
      dispatch({ type: 'CLIP_ADD', trackId: track.id, startBeat: start, lengthBeats: s.beatsPerBar });
    }
    openDock('editor');
  }, [dispatch, drumPatterns, drumState.activePatternId, drumState.patterns, openDock]);

  const clipMenu = (track: Track, clip: Clip, x: number, y: number, atBeat: number) => {
    const isDrums = track.source.type === 'drums';
    const linked = (patternUse.get(clip.patternId) ?? 0) > 1;
    const playhead = getPlayhead();
    const splitAt = clip.startBeat < playhead && playhead < clip.startBeat + clip.lengthBeats
      ? playhead : snapTo(atBeat, arrangeGrid(seqRef.current));
    const undoable = (a: Parameters<typeof dispatch>[0]) => () => { dispatch({ type: 'SEQ_PUSH_UNDO' }); dispatch(a); };
    const items: MenuItem[] = [
      { label: 'Edit', shortcut: 'dbl-click', onSelect: () => openDock('editor') },
      { divider: true, label: '' },
      { label: 'Duplicate', shortcut: 'Ctrl+D', onSelect: undoable({ type: 'CLIP_DUPLICATE', clipId: clip.id }) },
      ...(!isDrums ? [
        { label: 'Duplicate as linked', onSelect: undoable({ type: 'CLIP_DUPLICATE', clipId: clip.id, linked: true }) },
        { label: 'Make unique', disabled: !linked, onSelect: undoable({ type: 'CLIP_MAKE_UNIQUE', clipId: clip.id }) },
      ] : []),
      { label: 'Split', shortcut: 'Ctrl+E', onSelect: undoable({ type: 'CLIP_SPLIT', clipId: clip.id, atBeat: splitAt }) },
      { label: clip.muted ? 'Unmute clip' : 'Mute clip', onSelect: undoable({ type: 'CLIP_TOGGLE_MUTE', clipId: clip.id }) },
      ...(isDrums ? [{
        label: 'Drum pattern',
        submenu: drumState.patterns.map((p) => ({
          label: `${p.name}  ·  ${p.genre}`,
          checked: p.id === clip.patternId,
          onSelect: undoable({ type: 'CLIP_SET_PATTERN', clipId: clip.id, patternId: p.id }),
        })),
      }] : []),
      { divider: true, label: '' },
      { label: 'Delete', shortcut: 'Del', danger: true, onSelect: undoable({ type: 'CLIP_DELETE', clipId: clip.id }) },
    ];
    const name = isDrums ? drumPatterns.get(clip.patternId)?.name : seqRef.current.patterns[clip.patternId]?.name;
    return { x, y, items, title: name ?? 'Clip' };
  };

  // ── Track header menu ──
  const trackMenu = (track: Track, x: number, y: number) => {
    const idx = seq.tracks.findIndex((t) => t.id === track.id);
    const undoable = (a: Parameters<typeof dispatch>[0]) => () => { dispatch({ type: 'SEQ_PUSH_UNDO' }); dispatch(a); };
    const items: MenuItem[] = [
      ...(track.source.type !== 'drums' ? [
        { label: 'Choose instrument…', onSelect: () => { dispatch({ type: 'TRACK_SELECT', trackId: track.id }); openDock('instruments'); } },
        {
          label: 'Use an oscillator',
          submenu: state.tabs.map((t) => ({
            label: t.label,
            checked: track.source.type === 'oscillator' && track.source.tabId === t.id,
            onSelect: undoable({ type: 'TRACK_SET_SOURCE', trackId: track.id, source: { type: 'oscillator', tabId: t.id } }),
          })),
        },
      ] : [
        { label: 'Edit drum patterns', onSelect: () => { dispatch({ type: 'TRACK_SELECT', trackId: track.id }); openDock('editor'); } },
      ]),
      {
        label: 'Colour', submenu: TRACK_COLORS.map((c) => ({
          label: c, checked: track.color === c,
          onSelect: () => dispatch({ type: 'TRACK_UPDATE', trackId: track.id, patch: { color: c } }),
        })),
      },
      { label: 'Duplicate track', onSelect: undoable({ type: 'TRACK_DUPLICATE', trackId: track.id }) },
      { label: 'Move up', disabled: idx === 0, onSelect: undoable({ type: 'TRACK_MOVE', trackId: track.id, toIndex: idx - 1 }) },
      { label: 'Move down', disabled: idx === seq.tracks.length - 1, onSelect: undoable({ type: 'TRACK_MOVE', trackId: track.id, toIndex: idx + 1 }) },
      { divider: true, label: '' },
      {
        label: 'Delete track', danger: true,
        onSelect: () => {
          if (track.clips.length && !window.confirm(`Delete “${track.name}” and its ${track.clips.length} clip(s)?`)) return;
          dispatch({ type: 'SEQ_PUSH_UNDO' });
          dispatch({ type: 'TRACK_REMOVE', trackId: track.id });
        },
      },
    ];
    setMenu({ x, y, items, title: track.name });
  };

  // ── Render ──
  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0b0b0b]" onMouseDown={() => setFocusZone('arrange')}>
      <ArrangeToolbar openDock={openDock} />

      <div ref={lanesRef} data-arrange-lanes className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        {/* Ruler — sticks to the top while tracks scroll */}
        <div className="sticky top-0 z-20 flex bg-[#0b0b0b]" style={{ height: RULER_H }}>
          <div
            className="shrink-0 flex flex-col justify-end border-r border-b border-neutral-800 text-neutral-600 px-2 pb-1"
            style={{ width: HEADER_W, fontSize: 9 }}
          >
            <span className="tracking-widest">SECTIONS</span>
            <span className="tracking-widest mt-1.5">BARS · LOOP</span>
          </div>
          <Ruler view={view} width={laneW} onSeek={onSeek} />
        </div>

        {seq.tracks.map((track) => {
          const selected = track.id === seq.selectedTrackId;
          const dim = track.muted || (anySolo && !track.solo);
          const lane = track.lanes.find((l) => l.id === track.activeLaneId) ?? track.lanes[0];
          return (
            <div key={track.id}>
              <div className="flex" style={{ height: TRACK_H }}>
                <TrackHeaderCell
                  track={track}
                  selected={selected}
                  accent={accent}
                  tabs={state.tabs}
                  onMenu={(x, y) => trackMenu(track, x, y)}
                  openDock={openDock}
                />
                <LaneCanvas
                  track={track}
                  width={laneW}
                  height={TRACK_H}
                  onMouseDown={onLaneMouseDown}
                  onDoubleClick={(beat, clip) => {
                    if (clip) { dispatch({ type: 'CLIP_SELECT', clipId: clip.id }); openDock('editor'); }
                    else createClip(track, beat);
                  }}
                  draw={(ctx) => drawLane(ctx, {
                    track, view, width: laneW, height: TRACK_H,
                    beatsPerBar: seq.beatsPerBar, sections,
                    loop: { enabled: seq.loopEnabled, start: seq.loopStartBeat, end: seq.loopEndBeat },
                    patterns: seq.patterns, drumPatterns, patternUse,
                    selectedClipId: seq.selectedClipId, isSelectedTrack: selected, dim,
                  })}
                  deps={[track, view, laneW, sections, seq.loopEnabled, seq.loopStartBeat, seq.loopEndBeat,
                    lanePatterns.get(track.id), patternUse, seq.selectedClipId, selected, dim, seq.beatsPerBar]}
                  view={view}
                />
              </div>

              {track.showAutomation && (
                <div className="flex border-b border-neutral-900" style={{ height: AUTO_H }}>
                  <AutomationHeaderCell track={track} />
                  {lane ? (
                    <AutomationCanvas
                      track={track} lane={lane} view={view}
                      width={laneW} height={AUTO_H}
                      beatsPerBar={seq.beatsPerBar} grid={Math.min(grid, 1)}
                    />
                  ) : (
                    <div className="flex items-center px-3 text-xs text-neutral-600" style={{ width: laneW }}>
                      Pick a parameter on the left to start drawing automation for {track.name}.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Empty space under the tracks */}
        <div
          className="flex items-start"
          style={{ minHeight: 80 }}
          onDoubleClick={() => { dispatch({ type: 'SEQ_PUSH_UNDO' }); dispatch({ type: 'TRACK_ADD', source: { type: 'preset', presetId: 'keys-epiano' } }); }}
        >
          <div className="shrink-0 border-r border-neutral-900 h-full" style={{ width: HEADER_W, minHeight: 80 }} />
          <div className="px-3 py-3 text-xs text-neutral-700 leading-relaxed">
            {seq.tracks.length === 0
              ? 'No tracks yet — use “+ Instrument” or “+ Drums” above, or double-click here.'
              : 'Double-click an empty lane to create a clip · drag clips to move, Alt-drag to copy, drag edges to trim · Ctrl+wheel to zoom, Shift+wheel to scroll'}
          </div>
        </div>

        <PlayheadOverlay view={view} width={laneW} stoppedAt={seq.playheadBeat} isPlaying={seq.isPlaying} />
      </div>

      <ArrangeScrollbar view={view} width={laneW} songEnd={songEnd} />

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

function clipAt(track: Track, beat: number): Clip | null {
  for (let i = track.clips.length - 1; i >= 0; i--) {
    const c = track.clips[i];
    if (beat >= c.startBeat && beat < c.startBeat + c.lengthBeats) return c;
  }
  return null;
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function ArrangeToolbar({ openDock }: { openDock: (t: DockTab) => void }) {
  const { state, dispatch } = useAppStore();
  const seq = state.sequencer;
  const add = (source: Track['source']) => {
    dispatch({ type: 'SEQ_PUSH_UNDO' });
    dispatch({ type: 'TRACK_ADD', source });
    if (source.type === 'preset') openDock('instruments');
  };
  const btn = 'px-2 py-0.5 text-xs border border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-100 transition-colors';
  const zoom = (f: number) => dispatch({ type: 'SEQ_SET_ARR_VIEW', pxPerBeat: seq.arrPxPerBeat * f });

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 border-b border-neutral-800 bg-neutral-900/50 shrink-0 flex-wrap">
      <span className="text-xs text-neutral-600 tracking-widest mr-1">ARRANGE</span>
      <button className={btn} onClick={() => add({ type: 'preset', presetId: 'keys-epiano' })} title="Add a track that plays an instrument preset">
        + Instrument
      </button>
      <button className={btn} onClick={() => add({ type: 'drums' })} title="Add a drum track">+ Drums</button>
      <button
        className={btn}
        onClick={() => add({ type: 'oscillator', tabId: state.activeTabId })}
        title="Add a track that plays the active oscillator from the OSC LAB"
      >+ Oscillator</button>

      <span className="w-px h-4 bg-neutral-800 mx-1" />
      <label className="flex items-center gap-1 text-xs text-neutral-600" title="Grid for moving and trimming clips (hold Shift to ignore it)">
        GRID
        <select
          value={seq.arrangeSnap}
          onChange={(e) => dispatch({ type: 'SEQ_SET_ARRANGE_SNAP', snap: e.target.value as typeof seq.arrangeSnap })}
          className="bg-neutral-950 border border-neutral-700 text-neutral-200 px-1 py-0.5"
        >
          <option value="1/1">Bar</option>
          <option value="1/4">Beat</option>
          <option value="1/8">1/8</option>
          <option value="1/16">1/16</option>
        </select>
      </label>
      <button className={btn} onClick={() => zoom(0.8)} title="Zoom out (Ctrl+wheel)">−</button>
      <button className={btn} onClick={() => zoom(1.25)} title="Zoom in (Ctrl+wheel)">+</button>
      <button
        className={btn}
        title="Fit the whole song in view"
        onClick={() => {
          const el = document.querySelector('[data-arrange-lanes]') as HTMLElement | null;
          const w = (el?.clientWidth ?? 900) - HEADER_W;
          const beats = Math.max(seq.beatsPerBar * 4, seq.songLengthBars * seq.beatsPerBar);
          dispatch({ type: 'SEQ_SET_ARR_VIEW', startBeat: 0, pxPerBeat: (w - 20) / beats });
        }}
      >FIT</button>

      <label className="flex items-center gap-1 text-xs text-neutral-600 ml-1" title="Song length in bars">
        LENGTH
        <input
          type="number" min={1} max={999} value={seq.songLengthBars}
          onChange={(e) => { const v = parseInt(e.target.value, 10); if (v >= 1) dispatch({ type: 'SEQ_SET_SONG_LENGTH', bars: v }); }}
          className="w-12 bg-neutral-950 border border-neutral-700 text-neutral-200 font-mono text-center px-1 py-0.5"
        />
      </label>

      <span className="ml-auto text-neutral-700" style={{ fontSize: 9 }}>
        {seq.tracks.length} track{seq.tracks.length === 1 ? '' : 's'}
      </span>
    </div>
  );
}

// ─── Track header ─────────────────────────────────────────────────────────────

function TrackHeaderCell({
  track, selected, accent, tabs, onMenu, openDock,
}: {
  track: Track; selected: boolean; accent: string;
  tabs: { id: string; label: string }[];
  onMenu: (x: number, y: number) => void;
  openDock: (t: DockTab) => void;
}) {
  const { dispatch } = useAppStore();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(track.name);

  const toggle = (patch: Partial<Pick<Track, 'muted' | 'solo' | 'showAutomation'>>) =>
    dispatch({ type: 'TRACK_UPDATE', trackId: track.id, patch });

  return (
    <div
      className="shrink-0 flex items-stretch border-r border-b border-neutral-800 cursor-default"
      style={{ width: HEADER_W, backgroundColor: selected ? '#181818' : '#111' }}
      onMouseDown={() => dispatch({ type: 'TRACK_SELECT', trackId: track.id })}
      onContextMenu={(e) => { e.preventDefault(); onMenu(e.clientX, e.clientY); }}
    >
      <div className="w-1.5 shrink-0" style={{ backgroundColor: track.color }} />
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5 px-2">
        <div className="flex items-center gap-1 min-w-0">
          {editing ? (
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                dispatch({ type: 'TRACK_UPDATE', trackId: track.id, patch: { name: name.trim() || track.name } });
                setEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') { setName(track.name); setEditing(false); }
              }}
              className="w-full bg-neutral-950 border border-neutral-600 text-xs text-neutral-100 px-1"
              aria-label="Track name"
            />
          ) : (
            <span
              className="text-xs text-neutral-200 truncate font-medium"
              onDoubleClick={() => { setName(track.name); setEditing(true); }}
              title={`${track.name} — double-click to rename`}
            >{track.name}</span>
          )}
          {track.arp.enabled && (
            <span className="shrink-0 px-1 border text-[9px] leading-tight" style={{ borderColor: track.color, color: track.color }}>ARP</span>
          )}
        </div>
        <button
          className="text-left text-neutral-500 hover:text-neutral-200 truncate"
          style={{ fontSize: 10 }}
          onClick={() => openDock(track.source.type === 'drums' ? 'editor' : 'instruments')}
          title="Change this track's sound"
        >
          {track.source.type === 'drums' ? '🥁 ' : '♪ '}{sourceLabel(track, tabs)}
        </button>
        <input
          type="range" min={0} max={1.5} step={0.01} value={track.channel.gain}
          onChange={(e) => dispatch({ type: 'SEQ_SET_CHANNEL', trackId: track.id, channel: { gain: parseFloat(e.target.value) } })}
          className="w-full h-1"
          style={{ accentColor: track.color }}
          title={`Volume ${Math.round(track.channel.gain * 100)}%`}
          aria-label={`${track.name} volume`}
        />
      </div>
      <div className="flex flex-col justify-center gap-0.5 pr-1.5">
        <div className="flex gap-0.5">
          <HeaderToggle label="M" on={track.muted} color="#eab308" title="Mute (M)" onClick={() => toggle({ muted: !track.muted })} />
          <HeaderToggle label="S" on={track.solo} color={accent} title="Solo (S)" onClick={() => toggle({ solo: !track.solo })} />
        </div>
        <div className="flex gap-0.5">
          <HeaderToggle
            label="A" on={track.showAutomation} color="#a855f7" title="Show automation"
            onClick={() => toggle({ showAutomation: !track.showAutomation })}
          />
          <button
            className="w-5 h-4 text-xs leading-none border border-neutral-700 text-neutral-500 hover:text-neutral-200"
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onMenu(r.left, r.bottom); }}
            title="Track options"
            aria-label={`${track.name} options`}
          >⋯</button>
        </div>
      </div>
    </div>
  );
}

function HeaderToggle({ label, on, color, title, onClick }: { label: string; on: boolean; color: string; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className="w-5 h-4 text-[10px] font-bold leading-none border transition-colors"
      style={on ? { borderColor: color, color, backgroundColor: color + '26' } : { borderColor: '#404040', color: '#737373' }}
    >{label}</button>
  );
}

// ─── Automation header ────────────────────────────────────────────────────────

function AutomationHeaderCell({ track }: { track: Track }) {
  const { dispatch } = useAppStore();
  const lane = track.lanes.find((l) => l.id === track.activeLaneId) ?? track.lanes[0];
  const used = new Set(track.lanes.map((l) => l.target));
  const available = AUTOMATION_TARGET_LIST.filter((t) => !used.has(t));

  return (
    <div className="shrink-0 flex flex-col gap-1 justify-center px-2 border-r border-neutral-800 bg-[#0e0e0e]" style={{ width: HEADER_W }}>
      <div className="flex items-center gap-1">
        <span className="text-neutral-600 tracking-widest" style={{ fontSize: 9 }}>AUTO</span>
        {track.lanes.length > 0 && (
          <select
            value={lane?.id ?? ''}
            onChange={(e) => dispatch({ type: 'TRACK_UPDATE', trackId: track.id, patch: { activeLaneId: e.target.value } })}
            className="flex-1 min-w-0 bg-neutral-900 border border-neutral-700 text-xs text-neutral-300 px-1"
          >
            {track.lanes.map((l) => (
              <option key={l.id} value={l.id}>
                {AUTOMATION_TARGETS[l.target].label}{l.points.length ? ` (${l.points.length})` : ''}{l.enabled ? '' : ' — off'}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex items-center gap-1">
        {available.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              dispatch({ type: 'SEQ_PUSH_UNDO' });
              dispatch({ type: 'SEQ_ADD_LANE', trackId: track.id, target: e.target.value as AutomationTarget });
            }}
            className="flex-1 min-w-0 bg-neutral-900 border border-neutral-700 text-xs text-neutral-500 px-1"
            aria-label="Add automation lane"
          >
            <option value="">+ parameter…</option>
            {available.map((t) => <option key={t} value={t}>{AUTOMATION_TARGETS[t].label}</option>)}
          </select>
        )}
        {lane && (
          <>
            <button
              onClick={() => dispatch({ type: 'SEQ_TOGGLE_LANE', trackId: track.id, laneId: lane.id })}
              className="px-1 text-[10px] border"
              style={lane.enabled
                ? { borderColor: AUTOMATION_TARGETS[lane.target].color, color: AUTOMATION_TARGETS[lane.target].color }
                : { borderColor: '#404040', color: '#737373' }}
              title="Bypass this lane without deleting its points"
            >{lane.enabled ? 'ON' : 'OFF'}</button>
            <button
              onClick={() => { dispatch({ type: 'SEQ_PUSH_UNDO' }); dispatch({ type: 'SEQ_REMOVE_LANE', trackId: track.id, laneId: lane.id }); }}
              className="px-1 text-[10px] border border-neutral-700 text-neutral-500 hover:text-red-400"
              title="Delete this lane"
            >✕</button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Lane canvas ──────────────────────────────────────────────────────────────

function LaneCanvas({
  track, width, height, draw, deps, view, onMouseDown, onDoubleClick,
}: {
  track: Track; width: number; height: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
  deps: unknown[];
  view: ArrView;
  onMouseDown: (track: Track, e: React.MouseEvent<HTMLCanvasElement>) => void;
  onDoubleClick: (beat: number, clip: Clip | null) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  // Redraw only when this lane's inputs change — never on playhead movement
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    c.style.width = `${width}px`;
    c.style.height = `${height}px`;
    const ctx = c.getContext('2d');
    if (ctx) draw(ctx);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <canvas
      ref={ref}
      data-lane-track={track.id}
      className="block"
      onMouseDown={(e) => onMouseDown(track, e)}
      onDoubleClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const beat = Math.max(0, xToBeat(e.clientX - r.left, view));
        onDoubleClick(beat, clipAt(track, beat));
      }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - r.left;
        const beat = xToBeat(x, view);
        const c = clipAt(track, beat);
        let cursor = 'default';
        if (c) {
          const xs = beatToX(c.startBeat, view);
          const xe = beatToX(c.startBeat + c.lengthBeats, view);
          cursor = (Math.abs(x - xe) <= EDGE_PX || Math.abs(x - xs) <= EDGE_PX) && xe - xs > EDGE_PX * 2
            ? 'ew-resize' : 'grab';
        }
        e.currentTarget.style.cursor = cursor;
      }}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

// ─── Playhead ─────────────────────────────────────────────────────────────────

/**
 * A single absolutely-positioned line moved with a transform. The lanes never
 * redraw for playhead motion, which is what keeps playback smooth with many
 * tracks.
 */
function PlayheadOverlay({ view, width, stoppedAt, isPlaying }: {
  view: ArrView; width: number; stoppedAt: number; isPlaying: boolean;
}) {
  const { dispatch } = useAppStore();
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    const place = (beat: number) => {
      const el = ref.current;
      if (!el) return;
      const x = beatToX(beat, viewRef.current);
      el.style.transform = `translateX(${HEADER_W + x}px)`;
      el.style.display = x < 0 || x > width ? 'none' : 'block';
      // Page the view forward when the playhead runs off the right edge
      if (isPlaying && x > width - 24) {
        dispatch({ type: 'SEQ_SET_ARR_VIEW', startBeat: Math.max(0, beat - 2) });
      }
    };
    place(isPlaying ? getPlayhead() : stoppedAt);
    if (!isPlaying) return;
    return subscribePlayhead(place);
  }, [isPlaying, stoppedAt, width, view, dispatch]);

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-red-500"
      style={{ left: 0, boxShadow: '0 0 4px rgba(239,68,68,0.6)' }}
    >
      <div className="w-0 h-0 -ml-[5px] border-l-[5px] border-r-[5px] border-t-[7px] border-l-transparent border-r-transparent border-t-red-500" />
    </div>
  );
}

// ─── Horizontal scrollbar ─────────────────────────────────────────────────────

function ArrangeScrollbar({ view, width, songEnd }: { view: ArrView; width: number; songEnd: number }) {
  const { dispatch } = useAppStore();
  const visible = width / view.pxPerBeat;
  const total = Math.max(songEnd + visible * 0.5, view.startBeat + visible);
  return (
    <div className="flex shrink-0 border-t border-neutral-800 bg-neutral-950" style={{ height: 14 }}>
      <div style={{ width: HEADER_W }} className="shrink-0 border-r border-neutral-800" />
      <input
        type="range"
        min={0}
        max={Math.max(0, total - visible)}
        step={0.25}
        value={Math.min(view.startBeat, Math.max(0, total - visible))}
        onChange={(e) => dispatch({ type: 'SEQ_SET_ARR_VIEW', startBeat: parseFloat(e.target.value) })}
        className="flex-1 h-full opacity-60 hover:opacity-100"
        aria-label="Scroll the arrangement"
      />
    </div>
  );
}
