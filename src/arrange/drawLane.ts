import type { Clip, Marker, Pattern, Track } from '../utils/music';
import type { DrumPattern } from '../store/drumStore';
import { beatToX, type ArrView } from './geometry';
import { gray, ink } from '../ui/theme';

export interface LaneDrawInput {
  track: Track;
  view: ArrView;
  width: number;
  height: number;
  beatsPerBar: number;
  sections: (Marker & { endBeat: number })[];
  loop: { enabled: boolean; start: number; end: number };
  patterns: Record<string, Pattern>;
  drumPatterns: Map<string, DrumPattern>;
  /** patternId → number of clips using it, for the linked-clip badge. */
  patternUse: Map<string, number>;
  /** Selected clips (one, or several selected together). */
  selected: ReadonlySet<string>;
  isSelectedTrack: boolean;
  dim: boolean;
}

/** Track lane: grid, section tint, loop range and clips with a preview of their content. */
export function drawLane(ctx: CanvasRenderingContext2D, d: LaneDrawInput): void {
  const { width: W, height: H, view } = d;
  const dpr = ctx.canvas.width / Math.max(1, W);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = d.isSelectedTrack ? gray('#121212') : gray('#0d0d0d');
  ctx.fillRect(0, 0, W, H);

  // Section tint: a faint wash so you can read the song form across all lanes
  for (const s of d.sections) {
    const x0 = beatToX(s.beat, view);
    const x1 = beatToX(s.endBeat, view);
    if (x1 < 0 || x0 > W) continue;
    ctx.fillStyle = s.color + '0c';
    ctx.fillRect(x0, 0, x1 - x0, H);
  }

  if (d.loop.enabled) {
    const x0 = beatToX(d.loop.start, view);
    const x1 = beatToX(d.loop.end, view);
    ctx.fillStyle = ink(0.025);
    ctx.fillRect(x0, 0, x1 - x0, H);
  }

  // Grid — bars always, beats once there's room
  const visibleBeats = W / view.pxPerBeat;
  const first = Math.max(0, Math.floor(view.startBeat));
  const last = Math.ceil(view.startBeat + visibleBeats);
  const showBeats = view.pxPerBeat >= 12;
  for (let b = first; b <= last; b++) {
    const isBar = b % d.beatsPerBar === 0;
    if (!isBar && !showBeats) continue;
    const x = Math.round(beatToX(b, view)) + 0.5;
    const barIdx = b / d.beatsPerBar;
    ctx.strokeStyle = isBar ? (barIdx % 4 === 0 ? gray('#2b2b2b') : gray('#202020')) : gray('#171717');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  ctx.strokeStyle = gray('#1f1f1f');
  ctx.beginPath();
  ctx.moveTo(0, H - 0.5);
  ctx.lineTo(W, H - 0.5);
  ctx.stroke();

  for (const clip of d.track.clips) drawClip(ctx, d, clip);
}

function drawClip(ctx: CanvasRenderingContext2D, d: LaneDrawInput, clip: Clip): void {
  const { view, width: W, height: H, track } = d;
  const x = beatToX(clip.startBeat, view);
  const w = clip.lengthBeats * view.pxPerBeat;
  if (x > W || x + w < 0) return;

  const y = 3;
  const h = H - 6;
  const selected = d.selected.has(clip.id);
  const color = clip.color ?? track.color;
  const alpha = clip.muted || d.dim ? 0.35 : 1;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Body
  ctx.fillStyle = color + (selected ? '40' : '2a');
  roundRect(ctx, x + 0.5, y + 0.5, Math.max(2, w - 1), h - 1, 3);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 1, y + 1, Math.max(0, w - 2), h - 2);
  ctx.clip();

  // Header strip with the pattern name
  const headerH = 13;
  ctx.fillStyle = color + (selected ? 'cc' : '88');
  ctx.fillRect(x, y, w, headerH);

  const isDrums = track.source.type === 'drums';
  const dp = isDrums ? d.drumPatterns.get(clip.patternId) : undefined;
  const pat = isDrums ? undefined : d.patterns[clip.patternId];
  const name = dp?.name ?? pat?.name ?? '(missing pattern)';
  const linked = (d.patternUse.get(clip.patternId) ?? 0) > 1;

  if (w > 18) {
    ctx.fillStyle = gray('#0a0a0a');
    ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const label = `${linked ? '⧉ ' : ''}${name}${clip.muted ? ' (muted)' : ''}`;
    ctx.fillText(label, x + 4, y + headerH / 2 + 0.5, w - 8);
  }

  // Content preview, repeated for every loop of the pattern within the clip
  const bodyTop = y + headerH + 2;
  const bodyH = h - headerH - 4;
  const patLen = dp ? dp.stepCount * 0.25 : pat?.lengthBeats ?? 0;

  if (patLen > 0 && bodyH > 4) {
    if (pat && pat.notes.length) {
      let lo = 127, hi = 0;
      for (const n of pat.notes) { lo = Math.min(lo, n.midiNote); hi = Math.max(hi, n.midiNote); }
      const range = Math.max(6, hi - lo + 1);
      const rowH = Math.max(1, Math.min(4, bodyH / range));
      ctx.fillStyle = color;
      forEachRepeat(clip, patLen, (repStartBeat, uStart) => {
        for (const n of pat.notes) {
          if (n.startBeat >= patLen) continue;
          const u = n.startBeat - uStart;
          if (u < 0 || u >= clip.lengthBeats) continue;
          const nx = beatToX(clip.startBeat + u, view);
          const nw = Math.max(1.5, Math.min(n.durationBeats, clip.lengthBeats - u) * view.pxPerBeat - 0.5);
          const ny = bodyTop + (hi - n.midiNote) * (bodyH - rowH) / Math.max(1, range - 1);
          ctx.fillRect(nx, ny, nw, rowH);
        }
        void repStartBeat;
      });
    } else if (dp) {
      const rows = dp.voices.filter((v) => !v.muted && v.steps.some((s) => s.active)).slice(0, 8);
      const rowH = Math.max(1.5, bodyH / Math.max(4, rows.length));
      forEachRepeat(clip, patLen, (_rep, uStart) => {
        rows.forEach((voice, r) => {
          ctx.fillStyle = voice.color;
          voice.steps.forEach((s, i) => {
            if (!s.active || i >= dp.stepCount) return;
            const u = i * 0.25 - uStart;
            if (u < 0 || u >= clip.lengthBeats) return;
            const sx = beatToX(clip.startBeat + u, view);
            ctx.fillRect(sx, bodyTop + r * rowH, Math.max(1.5, view.pxPerBeat * 0.18), Math.max(1, rowH - 0.5));
          });
        });
      });
    }

    // Dashed line wherever the pattern loops around
    ctx.strokeStyle = color + '66';
    ctx.setLineDash([2, 3]);
    ctx.lineWidth = 1;
    const firstLoop = patLen - (clip.offsetBeats % patLen);
    for (let u = firstLoop; u < clip.lengthBeats - 1e-6; u += patLen) {
      const lx = Math.round(beatToX(clip.startBeat + u, view)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(lx, y + headerH);
      ctx.lineTo(lx, y + h);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  } else if (!dp && !pat && w > 40) {
    ctx.fillStyle = '#ef4444';
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('pattern missing', x + 4, bodyTop + 8);
  }

  ctx.restore();

  // Outline
  ctx.strokeStyle = selected ? gray('#ffffff') : color + 'aa';
  ctx.lineWidth = selected ? 1.5 : 1;
  roundRect(ctx, x + 0.5, y + 0.5, Math.max(2, w - 1), h - 1, 3);
  ctx.stroke();

  ctx.restore();
}

/** Calls back once per pattern repetition with the pattern-time offset of that repetition. */
function forEachRepeat(clip: Clip, patLen: number, fn: (repStartBeat: number, uStart: number) => void): void {
  // u = q − offset + k·P; iterate k so that the repetition overlaps the clip
  const off = clip.offsetBeats % patLen;
  for (let k = 0; -off + k * patLen < clip.lengthBeats; k++) {
    fn(clip.startBeat - off + k * patLen, off - k * patLen);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
