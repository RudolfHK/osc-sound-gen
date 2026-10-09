import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import {
  SEMITONE_H, KEY_W, RULER_H, MIN_NOTE_W, SNAP_BEATS,
  isBlackKey, noteNameFromMidi, snapBeat, uid,
  type SequencerNote, type Track, type Pattern, type Clip,
} from '../utils/music';
import { getInstrumentEngine } from '../engine/instruments';
import { getAudioEngine } from '../engine/audio';
import type { OscillatorTab } from '../engine/oscillator';
import { getPlayhead, subscribePlayhead } from '../engine/playhead';
import { getFocusZone, isTypingTarget, setFocusZone } from '../ui/focus';

// ─── Coordinate helpers ───────────────────────────────────────────────────────

interface ViewParams {
  pxPerBeat: number;
  viewStartBeat: number;
  viewLowNote: number;
  viewHighNote: number;
}

const beatToX = (beat: number, vp: ViewParams) => KEY_W + (beat - vp.viewStartBeat) * vp.pxPerBeat;
const xToBeat = (x: number, vp: ViewParams) => vp.viewStartBeat + (x - KEY_W) / vp.pxPerBeat;
const noteToY = (midi: number, vp: ViewParams) => RULER_H + (vp.viewHighNote - midi) * SEMITONE_H;
const yToNote = (y: number, vp: ViewParams) => Math.round(vp.viewHighNote - (y - RULER_H) / SEMITONE_H - 0.5);

const VEL_LANE_H = 50;

/** Computer-keyboard piano, C4 on A — the layout most DAWs use. */
const KEY_MIDI: Record<string, number> = {
  a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66,
  g: 67, y: 68, h: 69, u: 70, j: 71, k: 72, o: 73,
  l: 74, p: 75, ';': 76,
};

// ─── Preview through the track's own sound ────────────────────────────────────

/** Audition a note through the track's own sound source. */
export function previewNote(track: Track, tabs: OscillatorTab[], midi: number, velocity = 100): void {
  void getAudioEngine().getOrCreateAudioContext().then((ctx) => {
    const t = ctx.currentTime + 0.01;
    const opts = { trackId: track.id, patch: track.patch };
    const src = track.source;
    if (src.type === 'preset') {
      getInstrumentEngine().playNote(src.presetId, midi, velocity, t, 0.45, opts);
    } else if (src.type === 'oscillator') {
      const tab = tabs.find((x) => x.id === src.tabId);
      if (tab) getInstrumentEngine().playOscillatorNote(tab.oscillator, tab.advanced, midi, velocity, t, 0.4, opts);
    }
  });
}

// ─── Canvas renderer ──────────────────────────────────────────────────────────

function drawPianoRoll(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  pattern: Pattern,
  color: string,
  vp: ViewParams,
  selected: Set<string>,
  opts: { beatsPerBar: number; showVelocityLane: boolean },
  selectionRect: { x1: number; y1: number; x2: number; y2: number } | null,
) {
  const visibleBeats = (W - KEY_W) / vp.pxPerBeat;
  const totalNotes = vp.viewHighNote - vp.viewLowNote + 1;
  const gridH = totalNotes * SEMITONE_H;

  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, W, H);

  // Keys
  for (let midi = vp.viewLowNote; midi <= vp.viewHighNote; midi++) {
    const y = noteToY(midi, vp);
    const black = isBlackKey(midi);
    ctx.fillStyle = black ? '#1a1a1a' : '#262626';
    ctx.fillRect(0, y, KEY_W - 1, SEMITONE_H);
    if (!black || midi % 12 === 0) {
      ctx.fillStyle = midi % 12 === 0 ? '#999' : '#555';
      ctx.font = '8px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(noteNameFromMidi(midi), KEY_W - 4, y + SEMITONE_H / 2);
    }
    if (black) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(KEY_W, y, W - KEY_W, SEMITONE_H);
    }
    ctx.strokeStyle = midi % 12 === 0 ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.035)';
    ctx.beginPath();
    ctx.moveTo(KEY_W, y + SEMITONE_H + 0.5);
    ctx.lineTo(W, y + SEMITONE_H + 0.5);
    ctx.stroke();
  }

  // Beat / bar grid
  const firstBeat = Math.max(0, Math.floor(vp.viewStartBeat));
  const lastBeat = Math.ceil(vp.viewStartBeat + visibleBeats);
  for (let b = firstBeat; b <= lastBeat; b++) {
    const x = Math.round(beatToX(b, vp)) + 0.5;
    const isBar = b % opts.beatsPerBar === 0;
    ctx.strokeStyle = isBar ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)';
    ctx.beginPath(); ctx.moveTo(x, RULER_H); ctx.lineTo(x, RULER_H + gridH); ctx.stroke();
  }

  // Outside the pattern's loop: dimmed, because notes there don't play
  const loopX = beatToX(pattern.lengthBeats, vp);
  if (loopX < W) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(Math.max(KEY_W, loopX), RULER_H, W - Math.max(KEY_W, loopX), gridH);
  }

  // Ruler
  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(KEY_W, 0, W - KEY_W, RULER_H);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, KEY_W, RULER_H);
  // Loop range bar along the ruler, with a handle at the end
  const lx0 = beatToX(0, vp);
  ctx.fillStyle = color + '55';
  ctx.fillRect(Math.max(KEY_W, lx0), RULER_H - 5, Math.max(0, loopX - Math.max(KEY_W, lx0)), 4);
  if (loopX >= KEY_W && loopX <= W) {
    ctx.fillStyle = color;
    ctx.fillRect(loopX - 3, 2, 6, RULER_H - 3);
  }
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let b = firstBeat; b <= lastBeat; b++) {
    if (b % opts.beatsPerBar !== 0) continue;
    const x = beatToX(b, vp);
    ctx.fillStyle = '#777';
    ctx.fillText(String(Math.floor(b / opts.beatsPerBar) + 1), x + 3, RULER_H / 2 - 2);
  }
  ctx.strokeStyle = '#333';
  ctx.beginPath(); ctx.moveTo(0, RULER_H + 0.5); ctx.lineTo(W, RULER_H + 0.5); ctx.stroke();

  // Notes
  ctx.save();
  ctx.beginPath();
  ctx.rect(KEY_W, RULER_H, W - KEY_W, gridH);
  ctx.clip();
  for (const note of pattern.notes) {
    const nx = beatToX(note.startBeat, vp);
    const ny = noteToY(note.midiNote, vp);
    const nw = Math.max(MIN_NOTE_W, note.durationBeats * vp.pxPerBeat - 1);
    if (nx > W || nx + nw < KEY_W) continue;
    const isSel = selected.has(note.id);
    const outside = note.startBeat >= pattern.lengthBeats;
    ctx.globalAlpha = outside ? 0.3 : isSel ? 0.95 : (note.velocity / 127) * 0.65 + 0.35;
    ctx.fillStyle = isSel ? '#fff' : color;
    ctx.fillRect(nx, ny + 1, nw, SEMITONE_H - 2);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = isSel ? '#fff' : 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(nx + 0.5, ny + 1.5, nw - 1, SEMITONE_H - 3);
  }
  ctx.restore();

  if (selectionRect) {
    const { x1, y1, x2, y2 } = selectionRect;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    ctx.restore();
  }

  // Velocity lane
  if (opts.showVelocityLane) {
    const top = RULER_H + gridH;
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, top, W, VEL_LANE_H);
    ctx.strokeStyle = '#333';
    ctx.beginPath(); ctx.moveTo(0, top + 0.5); ctx.lineTo(W, top + 0.5); ctx.stroke();
    ctx.fillStyle = '#555';
    ctx.font = '8px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('VEL', 4, top + 4);
    for (const note of pattern.notes) {
      const nx = beatToX(note.startBeat, vp);
      if (nx < KEY_W || nx > W) continue;
      const bh = Math.max(2, (note.velocity / 127) * (VEL_LANE_H - 6));
      ctx.fillStyle = selected.has(note.id) ? '#fff' : color;
      ctx.globalAlpha = selected.has(note.id) ? 0.95 : 0.7;
      ctx.fillRect(nx, top + VEL_LANE_H - bh, 4, bh);
      ctx.globalAlpha = 1;
    }
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface PianoRollProps {
  track: Track;
  clip: Clip;
  pattern: Pattern;
  height: number;
  onSeek: (beat: number) => void;
}

type Drag = {
  type: 'move' | 'resize' | 'select' | 'vel' | 'loop';
  noteId?: string;
  startX: number;
  startY: number;
  origStart?: number;
  origMidi?: number;
  lastPreviewMidi?: number;
};

export function PianoRoll({ track, clip, pattern, height, onSeek }: PianoRollProps) {
  const { state, dispatch } = useAppStore();
  const seq = state.sequencer;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [selRect, setSelRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const vp: ViewParams = useMemo(() => ({
    pxPerBeat: seq.pxPerBeat,
    viewStartBeat: seq.viewStartBeat,
    viewLowNote: seq.viewLowNote,
    viewHighNote: seq.viewHighNote,
  }), [seq.pxPerBeat, seq.viewStartBeat, seq.viewLowNote, seq.viewHighNote]);
  const gridH = (vp.viewHighNote - vp.viewLowNote + 1) * SEMITONE_H;
  const totalH = Math.max(height, RULER_H + gridH) + (seq.showVelocityLane ? VEL_LANE_H : 0);
  const canvasH = RULER_H + gridH + (seq.showVelocityLane ? VEL_LANE_H : 0);

  // Latest values for native listeners
  const live = useRef({ seq, pattern, track, clip, vp, tabs: state.tabs });
  live.current = { seq, pattern, track, clip, vp, tabs: state.tabs };

  // ── Size ──
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // ── Draw (data changes only — the playhead is a separate overlay) ──
  // Only this editor's inputs trigger a redraw, not every change elsewhere in
  // the app (scrolling the arrangement, moving a fader).
  const selectedNoteIds = seq.selectedNoteIds;
  const { beatsPerBar, showVelocityLane } = seq;
  useLayoutEffect(() => {
    const selectedSet = new Set(selectedNoteIds);
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.max(1, Math.floor(width * dpr));
    c.height = Math.max(1, Math.floor(canvasH * dpr));
    c.style.width = `${width}px`;
    c.style.height = `${canvasH}px`;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPianoRoll(ctx, width, canvasH, pattern, track.color, vp, selectedSet,
      { beatsPerBar, showVelocityLane }, selRect);
  }, [width, canvasH, pattern, track.color, vp, selectedNoteIds, beatsPerBar, showVelocityLane, selRect]);

  // ── Playhead overlay: the song position mapped into this pattern ──
  useEffect(() => {
    const place = (songBeat: number) => {
      const el = playheadRef.current;
      if (!el) return;
      const { clip: c, pattern: p, vp: v } = live.current;
      const inside = songBeat >= c.startBeat && songBeat < c.startBeat + c.lengthBeats;
      if (!inside || p.lengthBeats <= 0) { el.style.display = 'none'; return; }
      const pos = (songBeat - c.startBeat + c.offsetBeats) % p.lengthBeats;
      const x = beatToX(pos, v);
      el.style.display = x < KEY_W ? 'none' : 'block';
      el.style.transform = `translateX(${x}px)`;
    };
    place(seq.isPlaying ? getPlayhead() : seq.playheadBeat);
    return subscribePlayhead(place);
  }, [seq.isPlaying, seq.playheadBeat, clip, pattern, seq.viewStartBeat, seq.pxPerBeat]);

  // ── Hit testing ──
  const pos = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const findNote = useCallback((x: number, y: number): SequencerNote | null => {
    const midi = yToNote(y, vp);
    const beat = xToBeat(x, vp);
    for (let i = pattern.notes.length - 1; i >= 0; i--) {
      const n = pattern.notes[i];
      if (n.midiNote === midi && beat >= n.startBeat && beat <= n.startBeat + n.durationBeats) return n;
    }
    return null;
  }, [pattern.notes, vp]); // eslint-disable-line react-hooks/exhaustive-deps

  const nearRightEdge = (n: SequencerNote, x: number) =>
    Math.abs(x - beatToX(n.startBeat + n.durationBeats, vp)) < 7 && n.durationBeats * vp.pxPerBeat > 12;

  const audition = (midi: number, vel = 100) => previewNote(track, state.tabs, midi, vel);

  // ── Mouse ──
  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setFocusZone('editor');
    const { x, y } = pos(e);
    const velTop = RULER_H + gridH;

    // Ruler: drag the loop-end handle, or click to move the song playhead here
    if (y < RULER_H) {
      if (x < KEY_W) return;
      if (Math.abs(x - beatToX(pattern.lengthBeats, vp)) <= 6) {
        dispatch({ type: 'SEQ_PUSH_UNDO' });
        dragRef.current = { type: 'loop', startX: x, startY: y };
        return;
      }
      const beat = Math.max(0, xToBeat(x, vp)) - clip.offsetBeats;
      onSeek(clip.startBeat + Math.max(0, Math.min(clip.lengthBeats, beat)));
      return;
    }

    // Piano keys: audition
    if (x < KEY_W) {
      if (y < RULER_H + gridH) audition(yToNote(y, vp));
      return;
    }

    if (y >= velTop && seq.showVelocityLane) {
      let best: SequencerNote | null = null;
      let bestD = 20;
      for (const n of pattern.notes) {
        const d = Math.abs(beatToX(n.startBeat, vp) - x);
        if (d < bestD) { bestD = d; best = n; }
      }
      if (best) {
        dispatch({ type: 'SEQ_PUSH_UNDO' });
        dragRef.current = { type: 'vel', noteId: best.id, startX: x, startY: y };
      }
      return;
    }

    const hit = findNote(x, y);

    if (e.button === 2) {
      if (hit) {
        dispatch({ type: 'SEQ_PUSH_UNDO' });
        dispatch({ type: 'SEQ_REMOVE_NOTE', patternId: pattern.id, noteId: hit.id });
      }
      return;
    }
    if (e.button !== 0) return;

    if (hit) {
      if (seq.editMode === 'select' || e.shiftKey || e.ctrlKey || e.metaKey) {
        const ids = e.shiftKey
          ? (seq.selectedNoteIds.includes(hit.id)
            ? seq.selectedNoteIds.filter((id) => id !== hit.id)
            : [...seq.selectedNoteIds, hit.id])
          : (seq.selectedNoteIds.includes(hit.id) ? seq.selectedNoteIds : [hit.id]);
        dispatch({ type: 'SEQ_SELECT_NOTES', ids });
      }
      dispatch({ type: 'SEQ_PUSH_UNDO' });
      dragRef.current = nearRightEdge(hit, x)
        ? { type: 'resize', noteId: hit.id, startX: x, startY: y }
        : { type: 'move', noteId: hit.id, startX: x, startY: y, origStart: hit.startBeat, origMidi: hit.midiNote, lastPreviewMidi: hit.midiNote };
      audition(hit.midiNote, hit.velocity);
      return;
    }

    if (seq.editMode === 'select') {
      dispatch({ type: 'SEQ_SELECT_NOTES', ids: [] });
      dragRef.current = { type: 'select', startX: x, startY: y };
      return;
    }

    // Draw a note — snap the start *down* so it lands in the cell clicked
    const grid = SNAP_BEATS[seq.snapValue];
    const beat = e.altKey ? xToBeat(x, vp) : Math.floor(xToBeat(x, vp) / grid) * grid;
    const midi = yToNote(y, vp);
    if (midi < 0 || midi > 127 || beat < 0) return;
    const note: SequencerNote = {
      id: uid('n'), midiNote: midi, startBeat: beat,
      durationBeats: SNAP_BEATS[seq.defaultNoteLength], velocity: 100,
    };
    dispatch({ type: 'SEQ_PUSH_UNDO' });
    dispatch({ type: 'SEQ_ADD_NOTE', patternId: pattern.id, note });
    dispatch({ type: 'SEQ_SELECT_NOTES', ids: [note.id] });
    dragRef.current = { type: 'resize', noteId: note.id, startX: x, startY: y };
    audition(midi);
  };

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d || !canvasRef.current) return;
      const { x, y } = pos(e);
      const { seq: s, pattern: p, vp: v } = live.current;
      const grid = SNAP_BEATS[s.snapValue];

      if (d.type === 'loop') {
        const beat = Math.max(grid, snapBeat(xToBeat(x, v), s.snapValue, e.shiftKey));
        dispatch({ type: 'PATTERN_SET_LENGTH', patternId: p.id, lengthBeats: beat });
      } else if (d.type === 'vel' && d.noteId) {
        const top = RULER_H + (v.viewHighNote - v.viewLowNote + 1) * SEMITONE_H;
        const vel = Math.round((1 - (y - top) / VEL_LANE_H) * 127);
        dispatch({ type: 'SEQ_SET_VELOCITY', patternId: p.id, noteId: d.noteId, velocity: vel });
      } else if (d.type === 'resize' && d.noteId) {
        const note = p.notes.find((n) => n.id === d.noteId);
        if (!note) return;
        const end = snapBeat(xToBeat(x, v), s.snapValue, e.shiftKey);
        dispatch({ type: 'SEQ_RESIZE_NOTE', patternId: p.id, noteId: d.noteId, durationBeats: Math.max(grid / 2, end - note.startBeat) });
      } else if (d.type === 'move' && d.noteId && d.origStart !== undefined && d.origMidi !== undefined) {
        const dx = (x - d.startX) / v.pxPerBeat;
        const dMidi = -Math.round((y - d.startY) / SEMITONE_H);
        const newStart = Math.max(0, snapBeat(d.origStart + dx, s.snapValue, e.shiftKey));
        const newMidi = Math.max(0, Math.min(127, d.origMidi + dMidi));
        // Move the whole selection together when the dragged note is part of it
        const group = s.selectedNoteIds.includes(d.noteId) && s.selectedNoteIds.length > 1;
        if (group) {
          const anchor = p.notes.find((n) => n.id === d.noteId);
          if (!anchor) return;
          const db = newStart - anchor.startBeat;
          const dm = newMidi - anchor.midiNote;
          if (db === 0 && dm === 0) return;
          for (const id of s.selectedNoteIds) {
            const n = p.notes.find((m) => m.id === id);
            if (n) dispatch({ type: 'SEQ_MOVE_NOTE', patternId: p.id, noteId: id, startBeat: Math.max(0, n.startBeat + db), midiNote: n.midiNote + dm });
          }
        } else {
          dispatch({ type: 'SEQ_MOVE_NOTE', patternId: p.id, noteId: d.noteId, startBeat: newStart, midiNote: newMidi });
        }
        if (newMidi !== d.lastPreviewMidi) {
          d.lastPreviewMidi = newMidi;
          previewNote(live.current.track, live.current.tabs, newMidi);
        }
      } else if (d.type === 'select') {
        setSelRect({ x1: d.startX, y1: d.startY, x2: x, y2: y });
      }
    };
    const up = (e: MouseEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (d?.type === 'select' && canvasRef.current) {
        const { x, y } = pos(e);
        const { pattern: p, vp: v } = live.current;
        const [bx1, bx2] = [Math.min(d.startX, x), Math.max(d.startX, x)];
        const [by1, by2] = [Math.min(d.startY, y), Math.max(d.startY, y)];
        const ids = p.notes.filter((n) => {
          const nx = beatToX(n.startBeat, v);
          const ny = noteToY(n.midiNote, v);
          return nx + n.durationBeats * v.pxPerBeat >= bx1 && nx <= bx2 && ny + SEMITONE_H >= by1 && ny <= by2;
        }).map((n) => n.id);
        dispatch({ type: 'SEQ_SELECT_NOTES', ids });
        setSelRect(null);
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dispatch]);

  // ── Keyboard (editor focus only) ──
  useEffect(() => {
    const held = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      if (getFocusZone() !== 'editor' || isTypingTarget(e.target)) return;
      const { seq: s, pattern: p } = live.current;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        dispatch({ type: 'SEQ_SELECT_NOTES', ids: p.notes.map((n) => n.id) });
      } else if (mod && e.key.toLowerCase() === 'c') {
        const notes = p.notes.filter((n) => s.selectedNoteIds.includes(n.id));
        if (notes.length) dispatch({ type: 'SEQ_COPY', notes });
      } else if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        // Paste after the selection if there is one, otherwise where it was copied from
        const sel = p.notes.filter((n) => s.selectedNoteIds.includes(n.id));
        const at = sel.length
          ? Math.max(...sel.map((n) => n.startBeat + n.durationBeats))
          : Math.min(...(s.copiedNotes ?? [{ startBeat: 0 }]).map((n) => n.startBeat));
        dispatch({ type: 'SEQ_PUSH_UNDO' });
        dispatch({ type: 'SEQ_PASTE', patternId: p.id, atBeat: at });
      } else if (mod) {
        return;
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selectedNoteIds.length) {
          e.preventDefault();
          dispatch({ type: 'SEQ_PUSH_UNDO' });
          dispatch({ type: 'SEQ_DELETE_SELECTED', patternId: p.id });
        }
      } else if (e.key === 'Escape') {
        dispatch({ type: 'SEQ_SELECT_NOTES', ids: [] });
      } else if (e.key === 'q' || e.key === 'Q') {
        if (s.selectedNoteIds.length) {
          dispatch({ type: 'SEQ_PUSH_UNDO' });
          dispatch({ type: 'SEQ_QUANTIZE', patternId: p.id });
        }
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (!s.selectedNoteIds.length) return;
        e.preventDefault();
        const step = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1);
        dispatch({ type: 'SEQ_PUSH_UNDO' });
        for (const n of p.notes) {
          if (s.selectedNoteIds.includes(n.id)) {
            dispatch({ type: 'SEQ_MOVE_NOTE', patternId: p.id, noteId: n.id, startBeat: n.startBeat, midiNote: n.midiNote + step });
          }
        }
      } else {
        const midi = KEY_MIDI[e.key.toLowerCase()];
        if (midi !== undefined && !held.has(e.key) && !e.repeat) {
          held.add(e.key);
          previewNote(live.current.track, live.current.tabs, midi);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => { held.delete(e.key); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [dispatch]);

  // ── Wheel: scroll time, Shift = pitch, Ctrl = zoom ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { seq: s, vp: v } = live.current;
      if (e.ctrlKey || e.metaKey) {
        // Read the zoom from the latest view, not a value captured at mount —
        // the old handler did, which pinned zoom to two fixed steps
        const r = canvas.getBoundingClientRect();
        const anchor = xToBeat(e.clientX - r.left, v);
        const px = Math.max(20, Math.min(400, v.pxPerBeat * (e.deltaY > 0 ? 0.85 : 1.18)));
        dispatch({ type: 'SEQ_SET_ZOOM', pxPerBeat: px });
        dispatch({ type: 'SEQ_SET_VIEW', startBeat: Math.max(0, anchor - (e.clientX - r.left - KEY_W) / px) });
      } else if (e.shiftKey) {
        const delta = e.deltaY > 0 ? -2 : 2;
        const low = Math.max(0, Math.min(127 - (s.viewHighNote - s.viewLowNote), s.viewLowNote + delta));
        dispatch({ type: 'SEQ_SET_VIEW', lowNote: low, highNote: low + (s.viewHighNote - s.viewLowNote) });
      } else {
        const d = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / v.pxPerBeat;
        dispatch({ type: 'SEQ_SET_VIEW', startBeat: Math.max(0, s.viewStartBeat + d) });
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [dispatch]);

  return (
    <div
      ref={containerRef}
      className="relative overflow-y-auto overflow-x-hidden"
      style={{ height: totalH > height ? height : totalH }}
      onMouseDown={() => setFocusZone('editor')}
    >
      <canvas
        ref={canvasRef}
        className="block"
        onMouseDown={onMouseDown}
        onMouseMove={(e) => {
          if (dragRef.current) return;
          const { x, y } = pos(e);
          let cursor = 'default';
          if (y < RULER_H && x >= KEY_W) {
            cursor = Math.abs(x - beatToX(pattern.lengthBeats, vp)) <= 6 ? 'ew-resize' : 'pointer';
          } else if (x < KEY_W) {
            cursor = 'pointer';
          } else if (y < RULER_H + gridH) {
            const n = findNote(x, y);
            cursor = n ? (nearRightEdge(n, x) ? 'ew-resize' : 'grab') : seq.editMode === 'draw' ? 'crosshair' : 'default';
          }
          e.currentTarget.style.cursor = cursor;
        }}
        onContextMenu={(e) => e.preventDefault()}
        aria-label={`Piano roll for ${pattern.name}`}
      />
      <div
        ref={playheadRef}
        className="pointer-events-none absolute top-0 w-px bg-red-500"
        style={{ left: 0, height: canvasH, display: 'none' }}
      />
    </div>
  );
}
