import { useEffect, useLayoutEffect, useRef } from 'react';
import { useVisualizerStore } from '../store/visualizerStore';
import { useAccent } from '../store/appStore';
import { Visualizer, VISUALIZER_MODES, type ColorMode, type VisualizerMode } from '../visualizer/spectrum';

const CANVAS_H = 180;

// ─── Small control ────────────────────────────────────────────────────────────

function Slider({
  label, value, min, max, step, format, color, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; color: string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5 w-[82px]">
      <div className="flex justify-between text-neutral-500" style={{ fontSize: 11 }}>
        <span>{label}</span>
        <span className="font-mono text-neutral-400">{format(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        className="w-full h-1" style={{ accentColor: color }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label={`Visualizer ${label.toLowerCase()}`}
        aria-valuetext={format(value)}
      />
    </div>
  );
}

function Toggle({
  label, on, color, onClick, title,
}: { label: string; on: boolean; color: string; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="px-2 py-0.5 text-xs border transition-colors"
      style={on
        ? { borderColor: color, color, backgroundColor: color + '18' }
        : { borderColor: 'var(--color-neutral-700)', color: 'var(--color-neutral-500)' }}
    >{label}</button>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function VisualizerPanel() {
  const { state, dispatch } = useVisualizerStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const vizRef = useRef<Visualizer | null>(null);

  const accent = useAccent();

  // ── Create / destroy ──
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const viz = new Visualizer(canvas);
    vizRef.current = viz;
    viz.resize(wrap.clientWidth, CANVAS_H);
    viz.start();

    const ro = new ResizeObserver(() => viz.resize(wrap.clientWidth, CANVAS_H));
    ro.observe(wrap);

    return () => {
      ro.disconnect();
      viz.destroy();
      vizRef.current = null;
    };
  }, []);

  // ── Push settings every render — cheap, and keeps the canvas in sync ──
  useEffect(() => {
    vizRef.current?.setSettings(state);
    vizRef.current?.setAccent(accent);
  }, [state, accent]);

  const set = (patch: Partial<typeof state>) => dispatch({ type: 'VIZ_SET', patch });

  return (
    <div className="flex flex-col border-b border-neutral-800 bg-[var(--surface-0)] shrink-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-neutral-800 bg-neutral-900/40">
        <span className="text-xs text-neutral-500 tracking-widest">VISUALIZER</span>

        <div className="flex border border-neutral-800">
          {VISUALIZER_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => set({ mode: m.id as VisualizerMode })}
              className="px-2 py-0.5 text-xs transition-colors"
              style={state.mode === m.id
                ? { backgroundColor: accent + '22', color: accent }
                : { color: 'var(--color-neutral-500)' }}
            >{m.label}</button>
          ))}
        </div>

        <button
          onClick={() => dispatch({ type: 'VIZ_TOGGLE_CONTROLS' })}
          className="px-2 py-0.5 text-xs border border-neutral-700 text-neutral-500 hover:text-neutral-300"
        >
          {state.showControls ? 'HIDE OPTIONS' : 'OPTIONS'}
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => dispatch({ type: 'VIZ_RESET' })}
            className="px-2 py-0.5 text-xs border border-neutral-700 text-neutral-500 hover:text-neutral-300"
          >RESET</button>
          <button
            onClick={() => dispatch({ type: 'VIZ_ENABLE', enabled: false })}
            className="px-2 py-0.5 text-xs border border-neutral-700 text-neutral-500 hover:text-red-400 hover:border-red-800 tracking-widest"
            title="Close the visualizer and stop its redraw loop"
          >✕ OFF</button>
        </div>
      </div>

      {/* Canvas */}
      <div ref={wrapRef} className="w-full" style={{ height: CANVAS_H }}>
        <canvas ref={canvasRef} className="block" />
      </div>

      {/* Options */}
      {state.showControls && (
        <div className="flex flex-wrap items-end gap-x-3 gap-y-1.5 px-3 py-1.5 border-t border-neutral-800/60">
          <Slider
            label="SENS" value={state.sensitivity} min={0.2} max={4} step={0.05}
            format={(v) => `${v.toFixed(2)}×`} color={accent}
            onChange={(v) => set({ sensitivity: v })}
          />
          <Slider
            label="SMOOTH" value={state.smoothing} min={0} max={0.95} step={0.01}
            format={(v) => `${Math.round(v * 100)}`} color={accent}
            onChange={(v) => set({ smoothing: v })}
          />
          <Slider
            label="DETAIL" value={state.barCount} min={16} max={192} step={2}
            format={(v) => `${Math.round(v)}`} color={accent}
            onChange={(v) => set({ barCount: Math.round(v) })}
          />
          <Slider
            label="TRAIL" value={state.trail} min={0} max={0.9} step={0.01}
            format={(v) => `${Math.round(v * 100)}`} color={accent}
            onChange={(v) => set({ trail: v })}
          />

          <div className="flex flex-col gap-0.5">
            <span className="text-neutral-500" style={{ fontSize: 11 }}>COLOR</span>
            <select
              value={state.colorMode}
              onChange={(e) => set({ colorMode: e.target.value as ColorMode })}
              aria-label="Visualizer colours"
              className="bg-neutral-900 border border-neutral-700 text-xs text-neutral-300 px-1 py-0.5"
            >
              <option value="theme">Theme</option>
              <option value="spectrum">Spectrum</option>
              <option value="mono">Mono</option>
            </select>
          </div>

          <Toggle label="MIRROR" on={state.mirror} color={accent}
            onClick={() => set({ mirror: !state.mirror })} />
          <Toggle label="GLOW" on={state.glow} color={accent}
            onClick={() => set({ glow: !state.glow })}
            title="Shadow blur — the single biggest cost in this panel" />
          <Toggle label={`${state.fpsCap} FPS`} on={state.fpsCap === 60} color={accent}
            onClick={() => set({ fpsCap: state.fpsCap === 60 ? 30 : 60 })}
            title="Halve the redraw rate to save CPU" />

          <span className="text-neutral-500 ml-auto max-w-[200px] leading-tight" style={{ fontSize: 11 }}>
            Turn GLOW off and drop to 30 FPS if playback starts to crackle.
          </span>
        </div>
      )}
    </div>
  );
}
