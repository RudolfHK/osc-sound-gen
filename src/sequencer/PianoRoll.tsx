import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import {
  SEMITONE_H, KEY_W, RULER_H, MIN_NOTE_W,
  isBlackKey, noteNameFromMidi, makeNoteId, snapBeat,
  type SequencerNote, type SequencerTrack,
} from '../utils/music';
import type { OscillatorTab } from '../engine/oscillator';

// ─── Coordinate helpers ───────────────────────────────────────────────────────

interface ViewParams {
  pxPerBeat: number;
  viewStartBeat: number;
  viewLowNote: number;
  viewHighNote: number;
}

function beatToX(beat: number, vp: ViewParams): number {
  return KEY_W + (beat - vp.viewStartBeat) * vp.pxPerBeat;
}
function xToBeat(x: number, vp: ViewParams): number {
  return vp.viewStartBeat + (x - KEY_W) / vp.pxPerBeat;
}
function noteToY(midiNote: number, vp: ViewParams): number {
  return RULER_H + (vp.viewHighNote - midiNote) * SEMITONE_H;
}
function yToNote(y: number, vp: ViewParams): number {
  return Math.round(vp.viewHighNote - (y - RULER_H) / SEMITONE_H);
}

const DEFAULT_DURATION = 0.5; // quarter beat default note length
const PX_PER_BEAT_DEFAULT = 80;

// ─── Canvas renderer ──────────────────────────────────────────────────────────

function drawPianoRoll(
  canvas: HTMLCanvasElement,
  track: SequencerTrack,
  tab: OscillatorTab,
  vp: ViewParams,
  seq: { bpm: number; beatsPerBar: number; songLengthBars: number; playheadBeat: number; isPlaying: boolean; loopEnabled: boolean; loopStartBeat: number; loopEndBeat: number; selectedNoteIds: string[] },
  accent: string,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;

  const visibleBeats = (W - KEY_W) / vp.pxPerBeat;
  const totalNotes = vp.viewHighNote - vp.viewLowNote + 1;
  const gridH = totalNotes * SEMITONE_H;

  // Background
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, W, H);

  // ── Piano keys (left sidebar) ─────────────────────────────────────────────
  for (let midi = vp.viewLowNote; midi <= vp.viewHighNote; midi++) {
    const y = noteToY(midi, vp);
    const isBlack = isBlackKey(midi);
    ctx.fillStyle = isBlack ? '#1a1a1a' : '#252525';
    ctx.fillRect(0, y, KEY_W - 1, SEMITONE_H);
    if (!isBlack) {
      ctx.fillStyle = '#555';
      ctx.font = '8px monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(noteNameFromMidi(midi), KEY_W - 4, y + SEMITONE_H / 2);
    }
  }

  // Key border
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(KEY_W, RULER_H);
  ctx.lineTo(KEY_W, RULER_H + gridH);
  ctx.stroke();

  // ── Horizontal grid lines ─────────────────────────────────────────────────
  for (let midi = vp.viewLowNote; midi <= vp.viewHighNote + 1; midi++) {
    const y = noteToY(midi - 1, vp) + SEMITONE_H;
    const isBlack = isBlackKey(midi);
    ctx.fillStyle = isBlack ? 'rgba(0,0,0,0.3)' : 'transparent';
    if (isBlack) ctx.fillRect(KEY_W, noteToY(midi, vp), W - KEY_W, SEMITONE_H);
    ctx.strokeStyle = midi % 12 === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(KEY_W, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // ── Vertical beat/bar grid ────────────────────────────────────────────────
  const firstBeat = Math.ceil(vp.viewStartBeat);
  const lastBeat = Math.floor(vp.viewStartBeat + visibleBeats) + 1;
  for (let b = firstBeat; b <= lastBeat; b++) {
    const x = beatToX(b, vp);
    const isBar = b % seq.beatsPerBar === 0;
    ctx.strokeStyle = isBar ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
    ctx.lineWidth = isBar ? 1.5 : 1;
    ctx.beginPath(); ctx.moveTo(x, RULER_H); ctx.lineTo(x, RULER_H + gridH); ctx.stroke();
  }

  // ── Loop region ───────────────────────────────────────────────────────────
  if (seq.loopEnabled) {
    const lx = beatToX(seq.loopStartBeat, vp);
    const lw = (seq.loopEndBeat - seq.loopStartBeat) * vp.pxPerBeat;
    ctx.fillStyle = accent + '18';
    ctx.fillRect(lx, RULER_H, lw, gridH);
    ctx.strokeStyle = accent + '55';
    ctx.lineWidth = 1;
    ctx.strokeRect(lx, RULER_H, lw, gridH);
  }

  // ── Timeline ruler ────────────────────────────────────────────────────────
  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(KEY_W, 0, W - KEY_W, RULER_H);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, KEY_W, RULER_H);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, RULER_H); ctx.lineTo(W, RULER_H); ctx.stroke();

  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let b = firstBeat; b <= lastBeat; b++) {
    if (b % seq.beatsPerBar !== 0) continue;
    const x = beatToX(b, vp);
    const bar = Math.floor(b / seq.beatsPerBar) + 1;
    ctx.fillStyle = '#666';
    ctx.fillText(`${bar}`, x, RULER_H / 2);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, RULER_H); ctx.stroke();
  }

  // ── Notes ─────────────────────────────────────────────────────────────────
  const selectedSet = new Set(seq.selectedNoteIds);
  for (const note of track.notes) {
    const nx = beatToX(note.startBeat, vp);
    const ny = noteToY(note.midiNote, vp);
    const nw = Math.max(MIN_NOTE_W, note.durationBeats * vp.pxPerBeat - 1);
    const nh = SEMITONE_H - 1;
    const selected = selectedSet.has(note.id);
    const alpha = (note.velocity / 127).toFixed(2);

    ctx.fillStyle = selected ? '#fff' : tab.color;
    ctx.globalAlpha = selected ? 0.9 : parseFloat(alpha) * 0.7 + 0.3;
    ctx.fillRect(nx, ny + 1, nw, nh);
    ctx.globalAlpha = 1;

    if (selected) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(nx, ny + 1, nw, nh);
    }
  }

  // ── Playhead ──────────────────────────────────────────────────────────────
  if (seq.isPlaying || seq.playheadBeat > 0) {
    const px = beatToX(seq.playheadBeat, vp);
    if (px >= KEY_W && px <= W) {
      ctx.strokeStyle = '#ff4040';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, RULER_H + gridH); ctx.stroke();
      ctx.fillStyle = '#ff4040';
      ctx.beginPath();
      ctx.moveTo(px - 5, 0); ctx.lineTo(px + 5, 0); ctx.lineTo(px, 8);
      ctx.fill();
    }
  }
}

// ─── PianoRoll component ──────────────────────────────────────────────────────

interface PianoRollProps {
  tab: OscillatorTab;
  track: SequencerTrack;
  accent: string;
  height: number;
}

export function PianoRoll({ tab, track, accent, height }: PianoRollProps) {
  const { state, dispatch } = useAppStore();
  const seq = state.sequencer;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pxPerBeat, setPxPerBeat] = useState(PX_PER_BEAT_DEFAULT);

  const vp: ViewParams = {
    pxPerBeat,
    viewStartBeat: seq.viewStartBeat,
    viewLowNote: seq.viewLowNote,
    viewHighNote: seq.viewHighNote,
  };

  // Resize canvas to container
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const observer = new ResizeObserver(() => {
      canvas.width = container.clientWidth;
      canvas.height = height;
    });
    observer.observe(container);
    canvas.width = container.clientWidth;
    canvas.height = height;
    return () => observer.disconnect();
  }, [height]);

  // Draw every frame (RAF-driven via state changes)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawPianoRoll(canvas, track, tab, vp, seq, accent);
  });

  // ─── Interaction ──────────────────────────────────────────────────────────

  const dragRef = useRef<{
    type: 'draw' | 'move' | 'resize' | 'select';
    noteId?: string;
    startX: number;
    startY: number;
    origStart?: number;
    origMidi?: number;
    origEnd?: number;
    rect?: { x: number; y: number; w: number; h: number };
  } | null>(null);

  const getCanvasPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const findNote = useCallback((x: number, y: number): SequencerNote | null => {
    const midi = yToNote(y, vp);
    const beat = xToBeat(x, vp);
    for (const note of [...track.notes].reverse()) {
      if (
        note.midiNote === midi &&
        beat >= note.startBeat &&
        beat <= note.startBeat + note.durationBeats
      ) return note;
    }
    return null;
  }, [track.notes, vp]);

  const isNearRightEdge = (note: SequencerNote, x: number) => {
    const noteEndX = beatToX(note.startBeat + note.durationBeats, vp);
    return Math.abs(x - noteEndX) < 8;
  };

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasPos(e);
    if (x < KEY_W || y < RULER_H) return;

    const existing = findNote(x, y);

    if (seq.editMode === 'draw') {
      if (e.button === 2 && existing) {
        // Right-click = delete
        dispatch({ type: 'SEQ_PUSH_UNDO' });
        dispatch({ type: 'SEQ_REMOVE_NOTE', tabId: tab.id, noteId: existing.id });
        return;
      }
      if (existing) {
        if (isNearRightEdge(existing, x)) {
          dragRef.current = { type: 'resize', noteId: existing.id, startX: x, startY: y, origEnd: existing.startBeat + existing.durationBeats };
        } else {
          dragRef.current = { type: 'move', noteId: existing.id, startX: x, startY: y, origStart: existing.startBeat, origMidi: existing.midiNote };
        }
        dispatch({ type: 'SEQ_PUSH_UNDO' });
      } else {
        // Draw new note
        const beat = snapBeat(xToBeat(x, vp), seq.snapValue);
        const midi = yToNote(y, vp);
        if (midi < 0 || midi > 127) return;
        const note: SequencerNote = {
          id: makeNoteId(), midiNote: midi, startBeat: beat,
          durationBeats: DEFAULT_DURATION, velocity: 100,
        };
        dispatch({ type: 'SEQ_PUSH_UNDO' });
        dispatch({ type: 'SEQ_ADD_NOTE', tabId: tab.id, note });
        dragRef.current = { type: 'resize', noteId: note.id, startX: x, startY: y, origEnd: beat + DEFAULT_DURATION };
      }
    } else {
      // Select mode
      if (existing) {
        if (!e.shiftKey) dispatch({ type: 'SEQ_SELECT_NOTES', ids: [existing.id] });
        else {
          const sel = seq.selectedNoteIds.includes(existing.id)
            ? seq.selectedNoteIds.filter((id) => id !== existing.id)
            : [...seq.selectedNoteIds, existing.id];
          dispatch({ type: 'SEQ_SELECT_NOTES', ids: sel });
        }
        if (isNearRightEdge(existing, x)) {
          dragRef.current = { type: 'resize', noteId: existing.id, startX: x, startY: y, origEnd: existing.startBeat + existing.durationBeats };
        } else {
          dragRef.current = { type: 'move', noteId: existing.id, startX: x, startY: y, origStart: existing.startBeat, origMidi: existing.midiNote };
        }
        dispatch({ type: 'SEQ_PUSH_UNDO' });
      } else {
        dispatch({ type: 'SEQ_SELECT_NOTES', ids: [] });
        dragRef.current = { type: 'select', startX: x, startY: y, rect: { x, y, w: 0, h: 0 } };
      }
    }
  }, [seq, tab.id, vp, findNote, dispatch]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { x, y } = getCanvasPos(e);

    if (drag.type === 'resize' && drag.noteId) {
      const beat = snapBeat(xToBeat(x, vp), seq.snapValue);
      const note = track.notes.find((n) => n.id === drag.noteId);
      if (!note) return;
      const newDur = Math.max(0.0625, beat - note.startBeat);
      dispatch({ type: 'SEQ_RESIZE_NOTE', tabId: tab.id, noteId: drag.noteId, durationBeats: newDur });
    } else if (drag.type === 'move' && drag.noteId && drag.origStart !== undefined && drag.origMidi !== undefined) {
      const dx = x - drag.startX;
      const dy = y - drag.startY;
      const dBeat = snapBeat(dx / vp.pxPerBeat, seq.snapValue);
      const dMidi = -Math.round(dy / SEMITONE_H);
      const newStart = Math.max(0, drag.origStart + dBeat);
      const newMidi = Math.max(0, Math.min(127, drag.origMidi + dMidi));
      dispatch({ type: 'SEQ_MOVE_NOTE', tabId: tab.id, noteId: drag.noteId, startBeat: newStart, midiNote: newMidi });
    }
  }, [seq, track.notes, tab.id, vp, dispatch]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag?.type === 'select') {
      // Box select
      const { x, y } = getCanvasPos(e);
      const bx1 = Math.min(drag.startX, x);
      const bx2 = Math.max(drag.startX, x);
      const by1 = Math.min(drag.startY, y);
      const by2 = Math.max(drag.startY, y);
      const ids = track.notes
        .filter((n) => {
          const nx = beatToX(n.startBeat, vp);
          const ny = noteToY(n.midiNote, vp);
          return nx + n.durationBeats * vp.pxPerBeat >= bx1 && nx <= bx2 && ny >= by1 && ny <= by2;
        })
        .map((n) => n.id);
      dispatch({ type: 'SEQ_SELECT_NOTES', ids });
    }
    dragRef.current = null;
  }, [track.notes, vp, dispatch]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (seq.selectedNoteIds.length > 0) {
          dispatch({ type: 'SEQ_PUSH_UNDO' });
          dispatch({ type: 'SEQ_DELETE_SELECTED' });
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.shiftKey ? dispatch({ type: 'SEQ_REDO' }) : dispatch({ type: 'SEQ_UNDO' });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [seq.selectedNoteIds, dispatch]);

  // Scroll to pan view
  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Zoom
      const factor = e.deltaY > 0 ? 0.85 : 1.18;
      setPxPerBeat((prev) => Math.max(20, Math.min(400, prev * factor)));
    } else if (e.shiftKey) {
      // Vertical scroll (note range)
      const delta = Math.round(e.deltaY / SEMITONE_H);
      dispatch({ type: 'SEQ_SET_VIEW', lowNote: seq.viewLowNote + delta, highNote: seq.viewHighNote + delta });
    } else {
      // Horizontal scroll
      const delta = e.deltaY / vp.pxPerBeat;
      dispatch({ type: 'SEQ_SET_VIEW', startBeat: Math.max(0, seq.viewStartBeat + delta) });
    }
  }, [seq.viewStartBeat, seq.viewLowNote, seq.viewHighNote, vp.pxPerBeat, dispatch]);

  return (
    <div ref={containerRef} className="relative overflow-hidden" style={{ height }}>
      <canvas
        ref={canvasRef}
        className="block"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={handleWheel}
        style={{ cursor: seq.editMode === 'draw' ? 'crosshair' : 'default' }}
      />
    </div>
  );
}
