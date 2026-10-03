import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { AUTOMATION_TARGETS, AUTOMATION_TARGET_LIST, laneValueAt } from '../engine/automation';
import { KEY_W, snapBeat } from '../utils/music';
import type { AutomationLane as Lane, AutomationTarget, SequencerTrack } from '../utils/music';

const LANE_H = 88;
const POINT_R = 4;
const HIT_R = 7;

// ─── Canvas rendering ─────────────────────────────────────────────────────────

function draw(
  canvas: HTMLCanvasElement,
  lane: Lane,
  seq: { viewStartBeat: number; pxPerBeat: number; beatsPerBar: number; playheadBeat: number; isPlaying: boolean; snapValue: string },
  hoverId: string | null,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  const spec = AUTOMATION_TARGETS[lane.target];

  const beatToX = (b: number) => KEY_W + (b - seq.viewStartBeat) * seq.pxPerBeat;
  const valueToY = (v: number) => H - 6 - v * (H - 12);

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0b0b0b';
  ctx.fillRect(0, 0, W, H);

  // ── Label gutter ──
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, KEY_W, H);
  ctx.fillStyle = lane.enabled ? spec.color : '#444';
  ctx.font = '9px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(spec.label.toUpperCase().slice(0, 9), KEY_W - 4, 10);

  // Current value readout at the playhead
  const atPlayhead = spec.toReal(laneValueAt(lane, seq.playheadBeat));
  ctx.fillStyle = '#666';
  ctx.fillText(spec.format(atPlayhead), KEY_W - 4, H - 10);

  // ── Horizontal guides at 0 / 50 / 100% ──
  ctx.strokeStyle = '#1c1c1c';
  ctx.lineWidth = 1;
  for (const v of [0, 0.5, 1]) {
    const y = valueToY(v);
    ctx.beginPath();
    ctx.moveTo(KEY_W, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // ── Bar lines ──
  const visibleBeats = (W - KEY_W) / seq.pxPerBeat;
  const first = Math.ceil(seq.viewStartBeat);
  const last = Math.floor(seq.viewStartBeat + visibleBeats) + 1;
  for (let b = first; b <= last; b++) {
    const x = beatToX(b);
    if (x < KEY_W) continue;
    const isBar = b % seq.beatsPerBar === 0;
    ctx.strokeStyle = isBar ? '#2a2a2a' : '#191919';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(KEY_W, 0, W - KEY_W, H);
  ctx.clip();

  // ── Envelope ──
  if (lane.points.length > 0) {
    const alpha = lane.enabled ? 1 : 0.35;
    ctx.globalAlpha = alpha;

    // Filled area under the curve reads the shape faster than a bare line
    ctx.beginPath();
    const startX = Math.max(KEY_W, beatToX(lane.points[0].beat));
    ctx.moveTo(KEY_W, valueToY(lane.points[0].value));
    ctx.lineTo(startX, valueToY(lane.points[0].value));
    for (const p of lane.points) ctx.lineTo(beatToX(p.beat), valueToY(p.value));
    const lastP = lane.points[lane.points.length - 1];
    ctx.lineTo(W, valueToY(lastP.value));
    ctx.strokeStyle = spec.color;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Close the path downward and fill
    ctx.lineTo(W, H);
    ctx.lineTo(KEY_W, H);
    ctx.closePath();
    ctx.fillStyle = spec.color + '22';
    ctx.fill();

    // ── Points ──
    for (const p of lane.points) {
      const x = beatToX(p.beat);
      const y = valueToY(p.value);
      if (x < KEY_W - 10 || x > W + 10) continue;
      const isHover = p.id === hoverId;
      ctx.beginPath();
      ctx.arc(x, y, isHover ? POINT_R + 1.5 : POINT_R, 0, Math.PI * 2);
      ctx.fillStyle = isHover ? '#fff' : spec.color;
      ctx.fill();
      ctx.strokeStyle = '#0b0b0b';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = '#3a3a3a';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('click to add a point', KEY_W + 10, H / 2);
  }

  // ── Playhead ──
  if (seq.isPlaying) {
    const px = beatToX(seq.playheadBeat);
    if (px >= KEY_W) {
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, H);
      ctx.stroke();
    }
  }

  ctx.restore();

  // Border
  ctx.strokeStyle = '#262626';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 0.5);
  ctx.lineTo(W, 0.5);
  ctx.stroke();
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  track: SequencerTrack;
  accent: string;
}

export function AutomationLane({ track, accent }: Props) {
  const { state, dispatch } = useAppStore();
  const seq = state.sequencer;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: LANE_H });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const dragRef = useRef<{ pointId: string } | null>(null);

  const lanes = track.lanes ?? [];
  const activeLane = lanes.find((l) => l.id === seq.activeLaneId) ?? lanes[0] ?? null;

  // ── Resize ──
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: Math.max(200, el.clientWidth), h: LANE_H });
    });
    ro.observe(el);
    setSize({ w: Math.max(200, el.clientWidth), h: LANE_H });
    return () => ro.disconnect();
  }, []);

  // ── Render ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeLane) return;
    canvas.width = size.w;
    canvas.height = size.h;
    draw(canvas, activeLane, {
      viewStartBeat: seq.viewStartBeat,
      pxPerBeat: seq.pxPerBeat,
      beatsPerBar: seq.beatsPerBar,
      playheadBeat: seq.playheadBeat,
      isPlaying: seq.isPlaying,
      snapValue: seq.snapValue,
    }, hoverId);
  }, [activeLane, size, seq.viewStartBeat, seq.pxPerBeat, seq.beatsPerBar,
      seq.playheadBeat, seq.isPlaying, seq.snapValue, hoverId]);

  // ── Coordinate helpers ──
  const toBeat = useCallback((clientX: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const x = clientX - rect.left;
    return seq.viewStartBeat + (x - KEY_W) / seq.pxPerBeat;
  }, [seq.viewStartBeat, seq.pxPerBeat]);

  const toValue = useCallback((clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const y = clientY - rect.top;
    return Math.max(0, Math.min(1, (size.h - 6 - y) / (size.h - 12)));
  }, [size.h]);

  const hitPoint = useCallback((clientX: number, clientY: number) => {
    if (!activeLane) return null;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    for (const p of activeLane.points) {
      const px = KEY_W + (p.beat - seq.viewStartBeat) * seq.pxPerBeat;
      const py = size.h - 6 - p.value * (size.h - 12);
      if (Math.abs(px - x) <= HIT_R && Math.abs(py - y) <= HIT_R) return p;
    }
    return null;
  }, [activeLane, seq.viewStartBeat, seq.pxPerBeat, size.h]);

  // ── Interaction ──
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!activeLane) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || e.clientX - rect.left < KEY_W) return;

    const hit = hitPoint(e.clientX, e.clientY);

    // Right-click removes a point
    if (e.button === 2) {
      if (hit) {
        dispatch({ type: 'SEQ_REMOVE_POINT', tabId: track.tabId, laneId: activeLane.id, pointId: hit.id });
      }
      return;
    }
    if (e.button !== 0) return;

    if (hit) {
      dragRef.current = { pointId: hit.id };
    } else {
      const beat = Math.max(0, snapBeat(toBeat(e.clientX), seq.snapValue, e.shiftKey));
      dispatch({
        type: 'SEQ_ADD_POINT',
        tabId: track.tabId, laneId: activeLane.id,
        beat, value: toValue(e.clientY),
      });
    }
  }, [activeLane, hitPoint, dispatch, track.tabId, toBeat, toValue, seq.snapValue]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!activeLane) return;

    if (dragRef.current) {
      const beat = Math.max(0, snapBeat(toBeat(e.clientX), seq.snapValue, e.shiftKey));
      dispatch({
        type: 'SEQ_MOVE_POINT',
        tabId: track.tabId, laneId: activeLane.id,
        pointId: dragRef.current.pointId,
        beat, value: toValue(e.clientY),
      });
      return;
    }

    const hit = hitPoint(e.clientX, e.clientY);
    setHoverId(hit?.id ?? null);
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = hit ? 'grab' : 'crosshair';
  }, [activeLane, hitPoint, dispatch, track.tabId, toBeat, toValue, seq.snapValue]);

  const endDrag = useCallback(() => { dragRef.current = null; }, []);

  useEffect(() => {
    window.addEventListener('mouseup', endDrag);
    return () => window.removeEventListener('mouseup', endDrag);
  }, [endDrag]);

  // ── Which targets are still available to add ──
  const used = new Set(lanes.map((l) => l.target));
  const available = AUTOMATION_TARGET_LIST.filter((t) => !used.has(t));

  return (
    <div className="flex flex-col border-t border-neutral-800 shrink-0">
      {/* Lane toolbar */}
      <div className="flex items-center gap-1.5 px-2 py-1 bg-neutral-900/40 border-b border-neutral-800/60">
        <span className="text-xs text-neutral-600 tracking-widest">AUTO</span>

        {lanes.length > 0 && (
          <select
            value={activeLane?.id ?? ''}
            onChange={(e) => dispatch({ type: 'SEQ_SET_ACTIVE_LANE', laneId: e.target.value })}
            className="bg-neutral-900 border border-neutral-700 text-xs text-neutral-300 px-1 py-0.5"
          >
            {lanes.map((l) => (
              <option key={l.id} value={l.id}>
                {AUTOMATION_TARGETS[l.target].label}{l.enabled ? '' : ' (off)'}
              </option>
            ))}
          </select>
        )}

        {available.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              dispatch({
                type: 'SEQ_ADD_LANE',
                tabId: track.tabId,
                target: e.target.value as AutomationTarget,
              });
            }}
            className="bg-neutral-900 border border-neutral-700 text-xs text-neutral-500 px-1 py-0.5"
            title="Add an automation lane"
          >
            <option value="">+ add…</option>
            {available.map((t) => (
              <option key={t} value={t}>{AUTOMATION_TARGETS[t].label}</option>
            ))}
          </select>
        )}

        {activeLane && (
          <>
            <button
              onClick={() => dispatch({ type: 'SEQ_TOGGLE_LANE', tabId: track.tabId, laneId: activeLane.id })}
              className="px-1.5 py-0.5 text-xs border transition-colors"
              style={activeLane.enabled
                ? { borderColor: AUTOMATION_TARGETS[activeLane.target].color, color: AUTOMATION_TARGETS[activeLane.target].color }
                : { borderColor: '#404040', color: '#737373' }}
              title="Bypass this lane without deleting it"
            >
              {activeLane.enabled ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={() => dispatch({ type: 'SEQ_CLEAR_LANE', tabId: track.tabId, laneId: activeLane.id })}
              className="px-1.5 py-0.5 text-xs border border-neutral-700 text-neutral-600 hover:text-neutral-300"
              title="Remove every point"
            >CLR</button>
            <button
              onClick={() => dispatch({ type: 'SEQ_REMOVE_LANE', tabId: track.tabId, laneId: activeLane.id })}
              className="px-1.5 py-0.5 text-xs border border-neutral-700 text-neutral-600 hover:text-red-400 hover:border-red-800"
              title="Delete this lane"
            >✕</button>
            <span className="text-neutral-700 font-mono" style={{ fontSize: 9 }}>
              {activeLane.points.length} pts
            </span>
          </>
        )}

        <span className="ml-auto text-neutral-700" style={{ fontSize: 9 }}>
          click add · drag move · right-click delete · shift = no snap
        </span>
      </div>

      {/* Canvas */}
      <div ref={wrapRef} className="w-full overflow-hidden" style={{ height: LANE_H }}>
        {activeLane ? (
          <canvas
            ref={canvasRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseLeave={() => setHoverId(null)}
            onContextMenu={(e) => e.preventDefault()}
            className="block"
          />
        ) : (
          <div
            className="h-full flex items-center justify-center text-xs text-neutral-700"
            style={{ borderLeft: `3px solid ${accent}33` }}
          >
            No automation on this track — add a lane above to draw filter sweeps, volume
            swells or send moves.
          </div>
        )}
      </div>
    </div>
  );
}
