import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { AUTOMATION_TARGETS } from '../engine/automation';
import { beatToX, xToBeat, snapTo, type ArrView } from '../arrange/geometry';
import type { AutomationLane as Lane, Track } from '../utils/music';
import { gray, useTheme } from '../ui/theme';
import { canvasPixelRatio, localPoint } from '../ui/scale';

const POINT_R = 4;
const HIT_R = 7;

interface Props {
  track: Track;
  lane: Lane;
  view: ArrView;
  width: number;
  height: number;
  beatsPerBar: number;
  /** Grid in beats for point placement. */
  grid: number;
}

/**
 * Breakpoint envelope editor for one automation lane, drawn in song time so it
 * lines up with the clips above it.
 *
 * Click empty space to add a point, drag to move, right-click to delete; hold
 * Shift to place off the grid. A whole drag is one undo step.
 */
export function AutomationCanvas({ track, lane, view, width, height, beatsPerBar, grid }: Props) {
  const { dispatch } = useAppStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const dragRef = useRef<{ pointId: string } | null>(null);
  const spec = AUTOMATION_TARGETS[lane.target];

  const valueToY = useCallback((v: number) => height - 5 - v * (height - 10), [height]);
  const yToValue = useCallback((y: number) => Math.max(0, Math.min(1, (height - 5 - y) / (height - 10))), [height]);

  // ── Render ──
  const theme = useTheme();
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = canvasPixelRatio();
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = gray('#0a0a0a');
    ctx.fillRect(0, 0, width, height);

    // Bars
    const first = Math.max(0, Math.floor(view.startBeat / beatsPerBar));
    const last = Math.ceil((view.startBeat + width / view.pxPerBeat) / beatsPerBar);
    for (let bar = first; bar <= last; bar++) {
      const x = Math.round(beatToX(bar * beatsPerBar, view)) + 0.5;
      ctx.strokeStyle = bar % 4 === 0 ? gray('#242424') : gray('#191919');
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    ctx.strokeStyle = gray('#1a1a1a');
    for (const v of [0, 0.5, 1]) {
      const y = Math.round(valueToY(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }

    const pts = lane.points;
    ctx.globalAlpha = lane.enabled ? 1 : 0.35;
    if (pts.length > 0) {
      ctx.beginPath();
      ctx.moveTo(0, valueToY(pts[0].value));
      for (const p of pts) ctx.lineTo(beatToX(p.beat, view), valueToY(p.value));
      ctx.lineTo(width, valueToY(pts[pts.length - 1].value));
      ctx.strokeStyle = spec.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.fillStyle = spec.color + '1c';
      ctx.fill();

      for (const p of pts) {
        const x = beatToX(p.beat, view);
        if (x < -8 || x > width + 8) continue;
        const hover = p.id === hoverId;
        ctx.beginPath();
        ctx.arc(x, valueToY(p.value), hover ? POINT_R + 1.5 : POINT_R, 0, Math.PI * 2);
        ctx.fillStyle = hover ? gray('#fff') : spec.color;
        ctx.fill();
        ctx.strokeStyle = gray('#0a0a0a');
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = gray('#3f3f3f');
      ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Click to draw ${spec.label.toLowerCase()} automation`, 10, height / 2);
    }
    ctx.globalAlpha = 1;
  }, [lane, view, width, height, beatsPerBar, hoverId, spec, valueToY, theme]);

  // ── Interaction ──
  const local = (e: { clientX: number; clientY: number }) => localPoint(e, canvasRef.current!);

  const hit = useCallback((x: number, y: number) => {
    for (const p of lane.points) {
      if (Math.abs(beatToX(p.beat, view) - x) <= HIT_R && Math.abs(valueToY(p.value) - y) <= HIT_R) return p;
    }
    return null;
  }, [lane.points, view, valueToY]);

  const onMouseDown = (e: React.MouseEvent) => {
    const { x, y } = local(e);
    const p = hit(x, y);
    if (e.button === 2) {
      if (p) {
        dispatch({ type: 'SEQ_PUSH_UNDO' });
        dispatch({ type: 'SEQ_REMOVE_POINT', trackId: track.id, laneId: lane.id, pointId: p.id });
      }
      return;
    }
    if (e.button !== 0) return;
    dispatch({ type: 'SEQ_PUSH_UNDO' });
    if (p) {
      dragRef.current = { pointId: p.id };
    } else {
      dispatch({
        type: 'SEQ_ADD_POINT', trackId: track.id, laneId: lane.id,
        beat: Math.max(0, snapTo(xToBeat(x, view), grid, e.shiftKey)),
        value: yToValue(y),
      });
    }
  };

  // Drag on window so the point follows the cursor outside the canvas too
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragRef.current || !canvasRef.current) return;
      const { x, y } = local(e);
      dispatch({
        type: 'SEQ_MOVE_POINT', trackId: track.id, laneId: lane.id,
        pointId: dragRef.current.pointId,
        beat: Math.max(0, snapTo(xToBeat(x, view), grid, e.shiftKey)),
        value: yToValue(y),
      });
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dispatch, track.id, lane.id, view, grid, yToValue]);

  return (
    <canvas
      ref={canvasRef}
      className="block"
      onMouseDown={onMouseDown}
      onMouseMove={(e) => {
        if (dragRef.current) return;
        const { x, y } = local(e);
        const p = hit(x, y);
        setHoverId(p?.id ?? null);
        e.currentTarget.style.cursor = p ? 'grab' : 'crosshair';
      }}
      onMouseLeave={() => setHoverId(null)}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`${spec.label} automation for ${track.name}`}
    />
  );
}
