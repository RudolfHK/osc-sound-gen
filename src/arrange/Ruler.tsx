import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAppStore, useAccent } from '../store/appStore';
import { sectionsFromMarkers, SECTION_COLORS, type Marker } from '../utils/music';
import { ContextMenu, type MenuItem } from '../ui/ContextMenu';
import {
  beatToX, xToBeat, snapTo, labelEvery, arrangeGrid,
  RULER_H, RULER_SECTION_H, RULER_CHORDS_H, RULER_BARS_H, RULER_BARS_TOP, type ArrView,
} from './geometry';
import { chordName, chordSpans, keyUsesFlats, PROGRESSIONS, progressionChords, type ChordMark } from '../utils/harmony';
import { detectChordsInRange } from '../utils/songAnalysis';
import { ChordDialog, useSongKey } from './ChordDialog';
import { openPartDialog } from './PartDialog';
import { openTransitionsDialog } from './TransitionsDialog';
import { notify } from '../ui/notices';
import { gray, shade, useTheme } from '../ui/theme';
import { canvasPixelRatio, localPoint } from '../ui/scale';

interface Props {
  view: ArrView;
  width: number;
  onSeek: (beat: number) => void;
}

type Drag =
  | { kind: 'marker'; id: string; grabBeat: number; origBeat: number; moved: boolean }
  | { kind: 'chord'; id: string; grabBeat: number; origBeat: number; moved: boolean }
  | { kind: 'loop-new'; anchor: number; moved: boolean; downX: number }
  | { kind: 'loop-start' | 'loop-end' };

/**
 * Three-row ruler: song sections on top, the chord track in the middle, and
 * the bar ruler with the loop brace at the bottom.
 */
export function Ruler({ view, width, onSeek }: Props) {
  const { state, dispatch } = useAppStore();
  const accent = useAccent();
  const seq = state.sequencer;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; title?: string } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; x: number; value: string } | null>(null);
  const [chordDialog, setChordDialog] = useState<{ beat: number; existing?: ChordMark } | null>(null);

  const songEnd = seq.songLengthBars * seq.beatsPerBar;
  const sections = useMemo(() => sectionsFromMarkers(seq.markers, songEnd), [seq.markers, songEnd]);
  const bar = seq.beatsPerBar;
  const chords = useMemo(() => chordSpans(seq.chords, songEnd), [seq.chords, songEnd]);
  const { key } = useSongKey();
  const flats = keyUsesFlats(key);

  const theme = useTheme();

  // ── Render ──
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = canvasPixelRatio();
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.floor(RULER_H * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${RULER_H}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Sections row
    ctx.fillStyle = gray('#0c0c0c');
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
      ctx.fillStyle = gray('#f5f5f5');
      ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.name, Math.max(x0, 0) + 6, RULER_SECTION_H / 2 + 0.5);
      ctx.restore();
    }
    if (sections.length === 0) {
      ctx.fillStyle = gray('#404040');
      ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText('Double-click here to add a section (Intro, Verse, Drop…)', 8, RULER_SECTION_H / 2);
    }

    // Chords row
    const ctop = RULER_SECTION_H;
    ctx.fillStyle = gray('#0e0e0e');
    ctx.fillRect(0, ctop, width, RULER_CHORDS_H);
    ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    chords.forEach((c, i) => {
      const x0 = beatToX(c.beat, view);
      const x1 = beatToX(c.endBeat, view);
      if (x1 < 0 || x0 > width) return;
      ctx.fillStyle = i % 2 ? gray('#1c1c1c') : gray('#222');
      ctx.fillRect(x0, ctop + 2, Math.max(1, x1 - x0 - 1), RULER_CHORDS_H - 4);
      ctx.fillStyle = accent;
      ctx.fillRect(x0, ctop + 2, 2, RULER_CHORDS_H - 4);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, ctop, Math.max(0, x1 - x0 - 2), RULER_CHORDS_H);
      ctx.clip();
      ctx.fillStyle = gray('#e5e5e5');
      ctx.fillText(chordName(c, flats), Math.max(x0, 0) + 6, ctop + RULER_CHORDS_H / 2 + 0.5);
      ctx.restore();
    });
    if (chords.length === 0) {
      ctx.fillStyle = gray('#404040');
      ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText('Chords: double-click to add one, right-click to detect them or fill a progression', 8, ctop + RULER_CHORDS_H / 2);
    }

    // Bars row
    const top = RULER_BARS_TOP;
    ctx.fillStyle = gray('#111');
    ctx.fillRect(0, top, width, RULER_BARS_H);

    // Song end shading
    const endX = beatToX(songEnd, view);
    if (endX < width) {
      ctx.fillStyle = shade(0.45);
      ctx.fillRect(Math.max(0, endX), top, width - Math.max(0, endX), RULER_BARS_H);
    }

    if (seq.loopEnabled || dragRef.current?.kind === 'loop-new') {
      const x0 = beatToX(seq.loopStartBeat, view);
      const x1 = beatToX(seq.loopEndBeat, view);
      ctx.fillStyle = (seq.loopEnabled ? accent : gray('#737373')) + '33';
      ctx.fillRect(x0, top + 1, x1 - x0, RULER_BARS_H - 2);
      ctx.fillStyle = seq.loopEnabled ? accent : gray('#737373');
      ctx.fillRect(x0, top + 1, x1 - x0, 3);
      ctx.fillRect(x0, top + 1, 2, RULER_BARS_H - 2);
      ctx.fillRect(x1 - 2, top + 1, 2, RULER_BARS_H - 2);
    }

    const pxPerBar = view.pxPerBeat * bar;
    const every = labelEvery(pxPerBar);
    const firstBar = Math.max(0, Math.floor(view.startBeat / bar));
    const lastBar = Math.ceil((view.startBeat + width / view.pxPerBeat) / bar);
    ctx.font = '10px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    for (let b = firstBar; b <= lastBar; b++) {
      const x = Math.round(beatToX(b * bar, view)) + 0.5;
      const labelled = b % every === 0;
      ctx.strokeStyle = labelled ? gray('#4a4a4a') : gray('#2a2a2a');
      ctx.beginPath();
      ctx.moveTo(x, top + (labelled ? 6 : 14));
      ctx.lineTo(x, top + RULER_BARS_H);
      ctx.stroke();
      if (labelled) {
        ctx.fillStyle = gray('#8a8a8a');
        ctx.fillText(String(b + 1), x + 3, top + 11);
      }
    }
    ctx.strokeStyle = gray('#2a2a2a');
    ctx.beginPath();
    ctx.moveTo(0, RULER_H - 0.5);
    ctx.lineTo(width, RULER_H - 0.5);
    ctx.stroke();
  }, [width, view, sections, chords, flats, seq.loopEnabled, seq.loopStartBeat, seq.loopEndBeat, songEnd, bar, accent, theme]);

  // ── Hit testing ──
  const local = (e: { clientX: number; clientY: number }) => localPoint(e, canvasRef.current!);
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
        { label: 'Add a transition into it…', disabled: s.beat <= 0, onSelect: () => openTransitionsDialog(s.id) },
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

    if (y < RULER_BARS_TOP) {
      const c = chordAtX(x);
      if (e.button === 2) {
        setMenu(chordMenu(e.clientX, e.clientY, beat));
        return;
      }
      if (e.button !== 0 || !c) return;
      dispatch({ type: 'SEQ_PUSH_UNDO' });
      dragRef.current = { kind: 'chord', id: c.id, grabBeat: beat, origBeat: c.beat, moved: false };
      return;
    }

    if (e.button === 2) {
      // Bar row: playhead and loop at this bar
      const at = snapTo(beat, bar);
      const barNo = Math.floor(at / bar) + 1;
      setMenu({
        x: e.clientX, y: e.clientY, title: `Bar ${barNo}`,
        items: [
          { label: 'Play from here', onSelect: () => onSeek(at) },
          { divider: true, label: '' },
          {
            label: 'Set loop start here', disabled: at >= seq.loopEndBeat,
            onSelect: () => dispatch({ type: 'SEQ_SET_LOOP', enabled: true, startBeat: at }),
          },
          {
            label: 'Set loop end here', disabled: at + bar <= seq.loopStartBeat,
            onSelect: () => dispatch({ type: 'SEQ_SET_LOOP', enabled: true, endBeat: at + bar }),
          },
          { label: `Loop bar ${barNo}`, onSelect: () => dispatch({ type: 'SEQ_SET_LOOP', enabled: true, startBeat: at, endBeat: at + bar }) },
          { divider: true, label: '' },
          { label: 'Add section here', onSelect: () => addMarker(beat) },
        ],
      });
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

  const chordAtX = (x: number) => {
    const beat = xToBeat(x, view);
    return chords.find((c) => beat >= c.beat && beat < c.endBeat) ?? null;
  };

  /** Right-click on the chord row: edit, detect chords, fill a progression. */
  const chordMenu = (x: number, y: number, beat: number): { x: number; y: number; items: MenuItem[]; title?: string } => {
    const at = chords.find((c) => beat >= c.beat && beat < c.endBeat);
    const sec = sections.find((s) => beat >= s.beat && beat < s.endBeat);
    const [from, to] = sec ? [sec.beat, sec.endBeat] : [0, songEnd];
    const where = sec ? `“${sec.name}”` : 'the whole song';
    const snapped = Math.max(0, Math.floor(beat / arrangeGrid(seq)) * arrangeGrid(seq));
    const replace = (label: string, list: Omit<ChordMark, 'id'>[]) => {
      dispatch({ type: 'SEQ_PUSH_UNDO', label });
      dispatch({ type: 'CHORDS_REPLACE', fromBeat: from, toBeat: to, chords: list });
    };
    const detect = (a: number, b: number, label: string) => {
      const found = detectChordsInRange(seq.tracks, seq.patterns, a, b, bar);
      if (!found.length) { notify('No chords found there — it needs notes on instrument tracks.', 'warn'); return; }
      dispatch({ type: 'SEQ_PUSH_UNDO', label });
      dispatch({ type: 'CHORDS_REPLACE', fromBeat: a, toBeat: b, chords: found });
      notify(`Found ${found.length} chord${found.length === 1 ? '' : 's'}.`);
    };
    const inRange = seq.chords.filter((c) => c.beat >= from && c.beat < to).length;
    return {
      x, y, title: at ? chordName(at, flats) : 'Chords',
      items: [
        ...(at ? [
          { label: 'Edit chord…', onSelect: () => setChordDialog({ beat: at.beat, existing: at }) },
          { label: 'Remove chord', danger: true, onSelect: () => dispatch({ type: 'CHORD_REMOVE', id: at.id }) },
        ] : []),
        { label: 'Add a chord here…', onSelect: () => setChordDialog({ beat: snapped }) },
        { divider: true, label: '' },
        { label: `Detect chords in ${where}`, onSelect: () => detect(from, to, 'Detect chords') },
        ...(sec ? [{ label: 'Detect chords in the whole song', onSelect: () => detect(0, songEnd, 'Detect chords') }] : []),
        {
          label: `Fill ${where} with a progression`,
          submenu: PROGRESSIONS.map((p) => {
            const list = progressionChords(key, p.numerals, p.mode);
            return {
              label: p.name,
              hint: list.map((c) => chordName(c, flats)).join(' – '),
              onSelect: () => replace('Chord progression', Array.from(
                { length: Math.ceil((to - from) / bar) },
                (_, i) => ({ beat: from + i * bar, ...list[i % list.length] }),
              )),
            };
          }),
        },
        { label: `Clear chords in ${where}`, disabled: inRange === 0, onSelect: () => replace('Clear chords', []) },
        { divider: true, label: '' },
        {
          label: `Write a part over ${where}…`, disabled: !chords.length,
          onSelect: () => openPartDialog(sec ? { from: sec.beat, to: sec.endBeat } : {}),
        },
      ],
    };
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
      if (d.kind === 'chord') {
        const target = Math.max(0, snapTo(d.origBeat + (beat - d.grabBeat), free ? 1 : arrangeGrid(seq)));
        if (target !== d.origBeat || d.moved) {
          d.moved = true;
          dispatch({ type: 'CHORD_UPDATE', id: d.id, patch: { beat: target } });
        }
      } else if (d.kind === 'marker') {
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
      // A click on a chord (no drag) opens it
      if (d.kind === 'chord' && !d.moved) {
        const c = seq.chords.find((x) => x.id === d.id);
        if (c) setChordDialog({ beat: c.beat, existing: c });
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [view, bar, dispatch, onSeek, seq]);

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
    if (y >= RULER_SECTION_H && y < RULER_BARS_TOP) {
      // Chord row: add a chord at the grid line under the mouse
      const g = arrangeGrid(seq);
      const beat = Math.max(0, Math.floor(xToBeat(x, view) / g) * g);
      const existing = seq.chords.find((c) => Math.abs(c.beat - beat) < 1e-6);
      setChordDialog({ beat, existing });
      return;
    }
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
        role="img"
        aria-label={rulerDescription(sections, chords, flats, bar)}
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        onMouseMove={(e) => {
          if (dragRef.current) return;
          const { x, y } = local(e);
          let cursor = 'pointer';
          if (y >= RULER_SECTION_H && y < RULER_BARS_TOP) {
            cursor = chordAtX(x) ? 'grab' : 'copy';
          } else if (y >= RULER_BARS_TOP && seq.loopEnabled) {
            const near = Math.abs(x - beatToX(seq.loopStartBeat, view)) <= 5 || Math.abs(x - beatToX(seq.loopEndBeat, view)) <= 5;
            if (near) cursor = 'ew-resize';
          } else if (y < RULER_SECTION_H && sectionAt(x)) cursor = 'grab';
          e.currentTarget.style.cursor = cursor;
        }}
        title="Sections: double-click to start a new section, double-click a name to rename, drag to move, right-click for options. Chords: double-click to add, click to edit, drag to move, right-click to detect or fill. Bars: click to move the playhead, drag to set the loop."
      />
      {chordDialog && <ChordDialog beat={chordDialog.beat} existing={chordDialog.existing} onClose={() => setChordDialog(null)} />}
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
          className="absolute top-0.5 h-4 px-1 text-xs bg-neutral-950 border border-neutral-500 text-neutral-100 focus:outline-hidden"
          style={{ left: renaming.x + 2, width: 140 }}
          aria-label="Section name"
        />
      )}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** What the ruler shows, for screen readers: the sections and the chords by bar. */
function rulerDescription(
  sections: { name: string; beat: number }[], chords: ChordMark[], flats: boolean, beatsPerBar: number,
): string {
  const at = (beat: number) => `bar ${Math.floor(beat / beatsPerBar) + 1}`;
  const secs = sections.map((s) => `${s.name} at ${at(s.beat)}`).join(', ');
  const shown = chords.slice(0, 24).map((c) => `${chordName(c, flats)} at ${at(c.beat)}`).join(', ');
  return `Timeline ruler. Sections: ${secs || 'none'}. Chords: ${shown || 'none'}${chords.length > 24 ? ', and more' : ''}.`;
}
