import { useEffect, useRef } from 'react';
import { useAppStore, useAccent } from '../store/appStore';
import { getAudioEngine } from '../engine/audio';
import { getChannelRack } from '../engine/channelStrip';
import { effectiveTrackMutes, type ChannelSettings, type Track } from '../utils/music';
import { gray } from '../ui/theme';

// ─── Metering ─────────────────────────────────────────────────────────────────
//
// One animation loop drives every meter, rather than one loop per strip.

type MeterSource = () => AnalyserNode | null;
const meters = new Map<HTMLCanvasElement, { source: MeterSource; color: string; peak: number; buf: Float32Array }>();
let meterRaf = 0;

function meterLoop() {
  for (const [canvas, m] of meters) {
    const a = m.source();
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    let level = 0;
    if (a) {
      if (m.buf.length !== a.fftSize) m.buf = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(m.buf as Float32Array<ArrayBuffer>);
      let peak = 0;
      for (let i = 0; i < m.buf.length; i++) peak = Math.max(peak, Math.abs(m.buf[i]));
      const db = 20 * Math.log10(Math.max(peak, 1e-5));
      level = Math.max(0, Math.min(1, (db + 54) / 54));
    }
    // Fast attack, slow release, like a hardware meter
    m.peak = level > m.peak ? level : Math.max(level, m.peak - 0.02);
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = gray('#141414');
    ctx.fillRect(0, 0, W, H);
    const h = m.peak * H;
    const g = ctx.createLinearGradient(0, H, 0, 0);
    g.addColorStop(0, m.color);
    g.addColorStop(0.75, m.color);
    g.addColorStop(0.9, '#f59e0b');
    g.addColorStop(1, '#ef4444');
    ctx.fillStyle = g;
    ctx.fillRect(0, H - h, W, h);
  }
  meterRaf = meters.size ? requestAnimationFrame(meterLoop) : 0;
}

function Meter({ source, color }: { source: MeterSource; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const srcRef = useRef(source);
  srcRef.current = source;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    meters.set(c, { source: () => srcRef.current(), color, peak: 0, buf: new Float32Array(512) });
    if (!meterRaf) meterRaf = requestAnimationFrame(meterLoop);
    return () => { meters.delete(c); };
  }, [color]);
  return <canvas ref={ref} width={6} height={96} className="rounded-xs" aria-hidden />;
}

// ─── Controls ─────────────────────────────────────────────────────────────────

function Knob({
  label, value, min, max, step, color, format, onChange, dim, onReset,
}: {
  label: string; value: number; min: number; max: number; step: number;
  color: string; format: (v: number) => string; onChange: (v: number) => void;
  dim?: boolean; onReset?: () => void;
}) {
  return (
    <label className="flex items-center gap-1" title={`${label}: ${format(value)}${onReset ? ' — double-click to reset' : ''}`}>
      <span className="shrink-0 font-mono w-5" style={{ fontSize: 11, color: dim ? 'var(--color-neutral-600)' : 'var(--color-neutral-400)' }}>{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        className="flex-1 h-0.5 min-w-0"
        style={{ accentColor: color }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onDoubleClick={onReset}
        aria-label={label}
      />
    </label>
  );
}

const db = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

function Strip({ track, mutedBySolo }: { track: Track; mutedBySolo: boolean }) {
  const { state, dispatch } = useAppStore();
  const accent = useAccent();
  const ch = track.channel;
  const selected = track.id === state.sequencer.selectedTrackId;
  const automated = new Set(track.lanes.filter((l) => l.enabled && l.points.length > 0).map((l) => l.target));
  const set = (patch: Partial<ChannelSettings>) => dispatch({ type: 'SEQ_SET_CHANNEL', trackId: track.id, channel: patch });
  const c = track.color;

  return (
    <div
      className="flex flex-col gap-1 px-1.5 py-1.5 border-r border-neutral-800 w-[96px] shrink-0"
      style={{ backgroundColor: selected ? 'var(--surface-2)' : undefined, opacity: mutedBySolo ? 0.55 : 1 }}
      onMouseDown={() => dispatch({ type: 'TRACK_SELECT', trackId: track.id })}
    >
      <div className="flex items-center gap-1 border-b pb-1" style={{ borderColor: c }}>
        <span className="text-xs text-neutral-300 truncate" title={track.name}>{track.name}</span>
      </div>

      <div className="flex flex-col gap-0.5">
        <span className="text-neutral-500 tracking-widest" style={{ fontSize: 11 }}>EQ</span>
        <Knob label="HI" value={ch.eqHigh} min={-18} max={18} step={0.5} color={c} format={db} dim={automated.has('eqHigh')}
          onChange={(v) => set({ eqHigh: v })} onReset={() => set({ eqHigh: 0 })} />
        <Knob label="MID" value={ch.eqMid} min={-18} max={18} step={0.5} color={c} format={db} dim={automated.has('eqMid')}
          onChange={(v) => set({ eqMid: v })} onReset={() => set({ eqMid: 0 })} />
        <Knob label="LO" value={ch.eqLow} min={-18} max={18} step={0.5} color={c} format={db} dim={automated.has('eqLow')}
          onChange={(v) => set({ eqLow: v })} onReset={() => set({ eqLow: 0 })} />
      </div>

      <div className="flex flex-col gap-0.5">
        <span className="text-neutral-500 tracking-widest" style={{ fontSize: 11 }}>SENDS</span>
        <Knob label="REV" value={ch.sendReverb} min={0} max={1} step={0.01} color="#8b5cf6" format={pct}
          dim={automated.has('sendReverb')} onChange={(v) => set({ sendReverb: v })} />
        <Knob label="DLY" value={ch.sendDelay} min={0} max={1} step={0.01} color="#06b6d4" format={pct}
          dim={automated.has('sendDelay')} onChange={(v) => set({ sendDelay: v })} />
        <Knob label="CHO" value={ch.sendChorus} min={0} max={1} step={0.01} color="#22c55e" format={pct}
          dim={automated.has('sendChorus')} onChange={(v) => set({ sendChorus: v })} />
        <Knob label="SC" value={ch.sidechain} min={0} max={1} step={0.01} color="#f97316" format={pct}
          onChange={(v) => set({ sidechain: v })} />
      </div>

      <div className="flex items-end gap-1.5 mt-auto pt-1 justify-center">
        <Meter source={() => getChannelRack().getAnalyser(track.id)} color={c} />
        <div className="flex flex-col items-center">
          <input
            type="range" min={0} max={1.5} step={0.01} value={ch.gain}
            className="h-24"
            style={{ accentColor: c, writingMode: 'vertical-lr', direction: 'rtl' } as React.CSSProperties}
            onChange={(e) => set({ gain: parseFloat(e.target.value) })}
            onDoubleClick={() => set({ gain: 1 })}
            title={`Fader ${pct(ch.gain)} — double-click for 100%`}
            aria-label={`${track.name} fader`}
          />
          <span className="font-mono" style={{ fontSize: 11, color: automated.has('volume') ? 'var(--color-neutral-600)' : 'var(--color-neutral-400)' }}>
            {Math.round(ch.gain * 100)}
          </span>
        </div>
      </div>

      <Knob
        label="PAN" value={track.pan} min={-1} max={1} step={0.01} color={c}
        format={(v) => (v === 0 ? 'C' : v > 0 ? `R${Math.round(v * 100)}` : `L${Math.round(-v * 100)}`)}
        dim={automated.has('pan')}
        onChange={(v) => dispatch({ type: 'TRACK_UPDATE', trackId: track.id, patch: { pan: v } })}
        onReset={() => dispatch({ type: 'TRACK_UPDATE', trackId: track.id, patch: { pan: 0 } })}
      />

      <div className="flex gap-0.5">
        <button
          onClick={() => dispatch({ type: 'TRACK_UPDATE', trackId: track.id, patch: { muted: !track.muted } })}
          aria-pressed={track.muted}
          className={`flex-1 h-4 text-[11px] font-bold border leading-none ${
            track.muted ? 'border-yellow-500 text-yellow-300 bg-yellow-900/30' : 'border-neutral-700 text-neutral-500 hover:text-neutral-300'
          }`}
        >M</button>
        <button
          onClick={() => dispatch({ type: 'TRACK_UPDATE', trackId: track.id, patch: { solo: !track.solo } })}
          aria-pressed={track.solo}
          className="flex-1 h-4 text-[11px] font-bold border leading-none"
          style={track.solo ? { borderColor: accent, color: accent, backgroundColor: accent + '22' } : { borderColor: 'var(--color-neutral-700)', color: 'var(--color-neutral-500)' }}
        >S</button>
      </div>
    </div>
  );
}

// ─── Mixer ────────────────────────────────────────────────────────────────────

export function Mixer() {
  const { state, dispatch } = useAppStore();
  const accent = useAccent();
  const tracks = state.sequencer.tracks;
  const mutes = effectiveTrackMutes(tracks);

  // The master meter reads the output — after the limiter and master fader
  const masterAnalyser = useRef<AnalyserNode | null>(null);
  const masterSource = () => {
    const engine = getAudioEngine();
    if (engine.isRenderingOffline) return null; // meters show the live mix only
    const ctx = engine.getAudioContext();
    const master = engine.getOutputNode();
    if (!ctx || !master) return null;
    if (!masterAnalyser.current || masterAnalyser.current.context !== ctx) {
      const a = ctx.createAnalyser();
      a.fftSize = 512;
      master.connect(a);
      masterAnalyser.current = a;
    }
    return masterAnalyser.current;
  };
  useEffect(() => () => { try { masterAnalyser.current?.disconnect(); } catch { /* ignore */ } }, []);

  return (
    <div className="flex h-full min-h-0 overflow-x-auto overflow-y-hidden bg-neutral-950">
      {tracks.map((t) => (
        <Strip key={t.id} track={t} mutedBySolo={(mutes.get(t.id) ?? false) && !t.muted} />
      ))}

      <div className="flex flex-col items-center gap-1 px-2 py-1.5 border-l border-neutral-700 w-[86px] shrink-0 ml-auto bg-[var(--surface-1)]">
        <span className="text-xs text-neutral-300 tracking-widest">MASTER</span>
        <div className="flex items-end gap-1.5 mt-auto">
          <Meter source={masterSource} color={accent} />
          <div className="flex flex-col items-center">
            <input
              type="range" min={0} max={1} step={0.01} value={state.masterVolume}
              className="h-32"
              style={{ accentColor: accent, writingMode: 'vertical-lr', direction: 'rtl' } as React.CSSProperties}
              onChange={(e) => dispatch({ type: 'SET_MASTER_VOLUME', volume: parseFloat(e.target.value) })}
              aria-label="Master fader"
            />
            <span className="text-[11px] text-neutral-500 font-mono">{Math.round(state.masterVolume * 100)}</span>
          </div>
        </div>
        <span className="text-neutral-500 text-center leading-tight" style={{ fontSize: 11 }}>
          limiter in FX
        </span>
      </div>

      {tracks.length === 0 && (
        <div className="flex items-center px-4 text-xs text-neutral-500">Add a track to see its channel strip.</div>
      )}
    </div>
  );
}
