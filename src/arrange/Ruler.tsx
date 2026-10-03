import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppStore, useAccent } from '../store/appStore';
import { sectionsFromMarkers, SECTION_COLORS, type Marker } from '../utils/music';
import { ContextMenu, type MenuItem } from '../ui/ContextMenu';
import {
  beatToX, xToBeat, snapTo, labelEvery,
  RULER_H, RULER_SECTION_H, RULER_BARS_H, type ArrView,
} from './geometry';

interface Props {
  view: ArrView;
  width: number;
  onSeek: (beat: number) => void;
}

type Drag =
  | { kind: 'marker'; id: string; grabBeat: number; origBeat: number; moved: boolean }
  | { kind: 'loop-new'; anchor: number; moved: boolean; downX: number }
  | { kind: 'loop-start' | 'loop-end' };

/**
 * Two-row ruler. The top row holds song sections; the bottom row is the bar
 * ruler with the loop brace.
 */
export function Ruler({ view, width, onSeek }: Props) {
  const { state, dispatch } = useAppStore();
  const accent = useAccent();
  const seq = state.sequencer;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; title?: string } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; x: number; value: string } | null>(null);

  const songEnd = seq.songLengthBars * seq.beatsPerBar;
  const sections = sectionsFromMarkers(seq.markers, songEnd);
  const bar = seq.beatsPerBar;

  // ── Render ──
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.floor(RULER_H * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${RULER_H}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Sections row
    ctx.fillStyle = '#0c0c0c';
    ctx.fillRect(0, 0, width, RULER_SECTION_H);
    for (const s of sections) {
      const x0 = beatToX(s.beat, view);
      const x1 = beatToX(s.endBeat, view);
      if (x1 < 0 || x0 > width) continue;
      ctx.fillStyle = s.color + '55';
      ctx.fillRect(x0, 2, Math.max(1, x1 - x0 - 1), RULER_SECTION_H - 4);
      ctx.fillStyle = s.color;
      ctx.fillRect(x0, 2, 2, RULER_SECTION_H - 4);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 0, Math.max(0, x1 - x0 - 2), RULER_SECTION_H);
      ctx.clip();
      ctx.fillStyle = '#f5f5f5';
      ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.name, Math.max(x0, 0) + 6, RULER_SECTION_H / 2 + 0.5);
      ctx.restore();
    }
    if (sections.length === 0) {
      ctx.fillStyle = '#404040';
      ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText('Double-click here to add a section (Intro, Verse, Drop…)', 8, RULER_SECTION_H / 2);
    }

    // Bars row
    const top = RULER_SECTION_H;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, top, width, RULER_BARS_H);

    // Song end shading
    const endX = beatToX(songEnd, view);
    if (endX < width) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(Math.max(0, endX), top, width - Math.max(0, endX), RULER_BARS_H);
    }

    if (seq.loopEnabled || dragRef.current?.kind === 'loop-new') {
      const x0 = beatToX(seq.loopStartBeat, view);
      const x1 = beatToX(seq.loopEndBeat, view);
      ctx.fillStyle = (seq.loopEnabled ? accent : '#737373') + '33';
      ctx.fillRect(x0, top + 1, x1 - x0, RULER_BARS_H - 2);
      ctx.fillStyle = seq.loopEnabled ? accent : '#737373';
      ctx.fillRect(x0, top + 1, x1 - x0, 3);
      ctx.fillRect(x0, top + 1, 2, RULER_BARS_H - 2);
      ctx.fillRect(x1 - 2, top + 1, 2, RULER_BARS_H - 2);
    }

    const pxPerBar = view.pxPerBeat * bar;
    const every = labelEvery(pxPerBar);
    const firstBar = Math.max(0, Math.floor(view.startBeat / bar));
    const lastBar = Math.ceil((view.startBeat + width / view.pxPerBeat) / bar);
    ctx.font = '9px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    for (let b = firstBar; b <= lastBar; b++) {
      const x = Math.round(beatToX(b * bar, view)) + 0.5;
      const labelled = b % every === 0;
      ctx.strokeStyle = labelled ? '#4a4a4a' : '#2a2a2a';
      ctx.beginPath();
      ctx.moveTo(x, top + (labelled ? 6 : 14));
      ctx.lineTo(x, top + RULER_BARS_H);
      ctx.stroke();
      if (labelled) {
        ctx.fillStyle = '#8a8a8a';
        ctx.fillText(String(b + 1), x + 3, top + 11);
      }
    }
    ctx.strokeStyle = '#2a2a2a';
    ctx.beginPath();
    ctx.moveTo(0, RULER_H - 0.5);
    ctx.lineTo(width, RULER_H - 0.5);
    ctx.stroke();
  }, [width, view, sections, seq.loopEnabled, seq.loopStartBeat, seq.loopEndBeat, songEnd, bar, accent]);

  // ── Hit testing ──
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const sectionAt = useCallback((x: number) => {
    const beat = xToBeat(x, view);
    return sections.find((s) => beat >= s.beat && beat < s.endBeat) ?? null;
  }, [sections, view]);

  const openSectionMenu = (s: Marker & { endBeat: number }, x: number, y: number, atBeat: number) => {
    setMenu({
      x, y, title: s.name,
      items: [
        { label: 'Loop this section', onSelect: () => dispatch({ type: 'SEQ_SET_LOOP', enabled: true, startBeat: s.beat, endBeat: s.endBeat }) },
        { label: 'Play from here', onSelect: () => onSeek(s.beat) },
        {
          label: 'Split section at this bar',
          disabled: snapTo(atBeat, bar) <= s.beat || snapTo(atBeat, bar) >= s.endBeat,
          onSelect: () => addMarker(atBeat),
        },
        { divider: true, label: '' },
        { label: 'Rename…', onSelect: () => setRenaming({ id: s.id, x: Math.max(0, beatToX(s.beat, view)), value: s.name }) },
        {
          label: 'Colour', submenu: SECTION_COLORS.map((c, i) => ({
            label: ['Indigo', 'Sky', 'Green', 'Yellow', 'Orange', 'Pink', 'Purple', 'Teal'][i],
            checked: s.color === c,
            onSelect: () => dispatch({ type: 'MARKER_UPDATE', id: s.id, patch: { color: c } }),
          })),
        },
        { divider: true, label: '' },
        {
          label: 'Duplicate section', shortcut: '',
          onSelect: () => { dispatch({ type: 'SEQ_PUSH_UNDO' }); dispatch({ type: 'SECTION_DUPLICATE', markerId: s.id }); },
        },
        {
          label: 'Delete section and its content', danger: true,
          onSelect: () => { dispatch({ type: 'SEQ_PUSH_UNDO' }); dispatch({ type: 'SECTION_DELETE', markerId: s.id }); },
        },
        {
          label: 'Remove marker only',
          onSelect: () => { dispatch({ type: 'SEQ_PUSH_UNDO' }); dispatch({ type: 'MARKER_REMOVE', id: s.id }); },
        },
      ],
    });
  };

  // ── Mouse ──
  const onMouseDown = (e: React.MouseEvent) => {
    const { x, y } = local(e);
    const beat = Math.max(0, xToBeat(x, view));

    if (y < RULER_SECTION_H) {
      const s = sectionAt(x);
      if (e.button === 2) {
        if (s) openSectionMenu(s, e.clientX, e.clientY, beat);
        else setMenu({ x: e.clientX, y: e.clientY, items: [{ label: 'Add section here', onSelect: () => addMarker(beat) }] });
        return;
      }
      if (e.button !== 0 || !s) return;
      dispatch({ type: 'SEQ_PUSH_UNDO' });
      dragRef.current = { kind: 'marker', id: s.id, grabBeat: beat, origBeat: s.beat, moved: false };
      return;
    }

    if (e.button !== 0) return;
    // Loop brace edges take precedence when the loop is showing
    if (seq.loopEnabled) {
      const xs = beatToX(seq.loopStartBeat, view);
      const xe = beatToX(seq.loopEndBeat, view);
      if (Math.abs(x - xs) <= 5) { dragRef.current = { kind: 'loop-start' }; return; }
      if (Math.abs(x - xe) <= 5) { dragRef.current = { kind: 'loop-end' }; return; }
    }
    dragRef.current = { kind: 'loop-new', anchor: snapTo(beat, bar), moved: false, downX: x };
  };

  const addMarker = useCallback((beat: number) => {
    dispatch({ type: 'SEQ_PUSH_UNDO' });
    dispatch({ type: 'MARKER_ADD', beat: snapTo(beat, bar) });
  }, [dispatch, bar]);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d || !canvasRef.current) return;
      const { x } = local(e);
      const beat = Math.max(0, xToBeat(x, view));
      const free = e.shiftKey;
      if (d.kind === 'marker') {
        const target = Math.max(0, snapTo(d.origBeat + (beat - d.grabBeat), bar, free));
        if (target !== d.origBeat || d.moved) {
          d.moved = true;
          dispatch({ type: 'MARKER_UPDATE', id: d.id, patch: { beat: target } });
        }
      } else if (d.kind === 'loop-new') {
        if (!d.moved && Math.abs(x - d.downX) < 4) return;
        d.moved = true;
        const b = snapTo(beat, bar, free);
        dispatch({ type: 'SEQ_SET_LOOP', enabled: true, startBeat: Math.min(d.anchor, b), endBeat: Math.max(d.anchor, b, d.anchor + 0.25) });
      } else if (d.kind === 'loop-start') {
        dispatch({ type: 'SEQ_SET_LOOP', startBeat: Math.min(snapTo(beat, bar, free), seq.loopEndBeat - 0.25) });
      } else if (d.kind === 'loop-end') {
        dispatch({ type: 'SEQ_SET_LOOP', endBeat: Math.max(snapTo(beat, bar, free), seq.loopStartBeat + 0.25) });
      }
    };
    const up = (e: MouseEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d || !canvasRef.current) return;
      const { x } = local(e);
      const beat = Math.max(0, xToBeat(x, view));
      // A click that didn't drag is a seek
      if (d.kind === 'loop-new' && !d.moved) onSeek(snapTo(beat, e.shiftKey ? 0.25 : 1));
      if (d.kind === 'marker' && !d.moved) onSeek(d.origBeat);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [view, bar, dispatch, onSeek, seq.loopEndBeat, seq.loopStartBeat]);

  /** Width of a section's name label, which is where double-click renames. */
  const labelWidth = (name: string) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return 60;
    ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
    return ctx.measureText(name).width + 14;
  };

  // Double-click a section's name to rename it; anywhere else starts a new
  // section at that bar (splitting the one it lands in).
  const onDoubleClick = (e: React.MouseEvent) => {
    const { x, y } = local(e);
    if (y >= RULER_SECTION_H) return;
    const s = sectionAt(x);
    const startX = s ? Math.max(0, beatToX(s.beat, view)) : 0;
    if (s && x - startX <= labelWidth(s.name)) {
      setRenaming({ id: s.id, x: startX, value: s.name });
    } else {
      addMarker(Math.max(0, xToBeat(x, view)));
    }
  };

  return (
    <div className="relative" style={{ height: RULER_H }}>
      <canvas
        ref={canvasRef}
        className="block cursor-pointer"
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        onMouseMove={(e) => {
          if (dragRef.current) return;
          const { x, y } = local(e);
          let cursor = 'pointer';
          if (y >= RULER_SECTION_H && seq.loopEnabled) {
            const near = Math.abs(x - beatToX(seq.loopStartBeat, view)) <= 5 || Math.abs(x - beatToX(seq.loopEndBeat, view)) <= 5;
            if (near) cursor = 'ew-resize';
          } else if (y < RULER_SECTION_H && sectionAt(x)) cursor = 'grab';
          e.currentTarget.style.cursor = cursor;
        }}
        title="Sections: double-click to start a new section, double-click a name to rename, drag to move, right-click for options. Bars: click to move the playhead, drag to set the loop."
      />
      {renaming && (
        <input
          autoFocus
          value={renaming.value}
          onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
          onBlur={() => {
            dispatch({ type: 'MARKER_UPDATE', id: renaming.id, patch: { name: renaming.value.trim() || 'Section' } });
            setRenaming(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setRenaming(null);
          }}
          className="absolute top-0.5 h-4 px-1 text-xs bg-neutral-950 border border-neutral-500 text-neutral-100 focus:outline-none"
          style={{ left: renaming.x + 2, width: 140 }}
          aria-label="Section name"
        />
      )}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
