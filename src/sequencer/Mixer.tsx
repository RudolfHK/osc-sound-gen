import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { getAudioEngine } from '../engine/audio';
import { THEME_COLORS } from '../utils/math';
import { makeDefaultChannel } from '../utils/music';
import type { ChannelSettings } from '../utils/music';

// Pre-allocated buffer for VU meter reads — never allocate inside the draw loop
const VU_BUF_SIZE = 256;

// ─── VU Meter canvas ──────────────────────────────────────────────────────────

function VUMeter({ analyser, color }: { analyser: AnalyserNode | null; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const bufRef = useRef(new Float32Array(VU_BUF_SIZE));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (bufRef.current.length !== analyser.fftSize) {
      bufRef.current = new Float32Array(analyser.fftSize);
    }
    const buf = bufRef.current;

    const draw = () => {
      analyser.getFloatTimeDomainData(buf);
      let rms = 0;
      for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
      rms = Math.sqrt(rms / buf.length);
      const db = 20 * Math.log10(Math.max(rms, 1e-6));
      const level = Math.max(0, Math.min(1, (db + 60) / 60)); // -60 dB → 0 dB

      const W = canvas.width;
      const H = canvas.height;
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, W, H);

      const barH = H * level;
      const gradient = ctx.createLinearGradient(0, H, 0, 0);
      gradient.addColorStop(0, color);
      gradient.addColorStop(0.7, color);
      gradient.addColorStop(0.9, '#ffb000');
      gradient.addColorStop(1, '#ff4040');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, H - barH, W, barH);

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyser, color]);

  return <canvas ref={canvasRef} width={7} height={44} className="rounded-sm" />;
}

// ─── Compact labelled slider ──────────────────────────────────────────────────

function Row({
  label, value, min, max, step, color, format, onChange, dim,
}: {
  label: string; value: number; min: number; max: number; step: number;
  color: string; format: (v: number) => string;
  onChange: (v: number) => void; dim?: boolean;
}) {
  return (
    <div className="flex items-center gap-1" title={`${label}: ${format(value)}`}>
      <span
        className="shrink-0 font-mono w-4"
        style={{ fontSize: 8, color: dim ? '#525252' : '#737373' }}
      >{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        className="flex-1 h-0.5 min-w-0"
        style={{ accentColor: color }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

// ─── Channel strip ────────────────────────────────────────────────────────────

function ChannelStrip({ tabId }: { tabId: string }) {
  const { state, dispatch } = useAppStore();
  const tab = state.tabs.find((t) => t.id === tabId);
  const track = state.sequencer.tracks.find((t) => t.tabId === tabId);

  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const anyPlaying = state.tabs.some((t) => t.isPlaying) || state.sequencer.isPlaying;

  useEffect(() => {
    const audioEngine = getAudioEngine();
    const audioCtx = audioEngine.getAudioContext();
    const master = audioEngine.getMasterGain();
    if (!audioCtx || !master) {
      setAnalyser(null);
      return;
    }
    const node = audioCtx.createAnalyser();
    node.fftSize = VU_BUF_SIZE;
    master.connect(node);
    setAnalyser(node);
    return () => {
      try { master.disconnect(node); } catch (_) { /* ignore */ }
      setAnalyser(null);
    };
  }, [tabId, anyPlaying]);

  if (!tab || !track) return null;
  const color = tab.color;
  const ch: ChannelSettings = track.channel ?? makeDefaultChannel();

  // Lanes driving a parameter take it over from the fader, so dim what's automated
  const automated = new Set(
    (track.lanes ?? []).filter((l) => l.enabled && l.points.length > 0).map((l) => l.target),
  );

  const setCh = (patch: Partial<ChannelSettings>) =>
    dispatch({ type: 'SEQ_SET_CHANNEL', tabId, channel: patch });

  const db = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div className="flex flex-col gap-1 px-1.5 py-1.5 border-r border-neutral-800 w-[92px] shrink-0">
      {/* Label */}
      <div className="flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="text-xs font-mono text-neutral-400 truncate" title={tab.label}>{tab.label}</span>
      </div>

      {/* EQ */}
      <div className="flex flex-col gap-0.5">
        <span className="text-neutral-700 tracking-widest" style={{ fontSize: 8 }}>EQ</span>
        <Row label="HI" value={ch.eqHigh} min={-18} max={18} step={0.5} color={color}
          format={db} dim={automated.has('eqHigh')} onChange={(v) => setCh({ eqHigh: v })} />
        <Row label="MD" value={ch.eqMid} min={-18} max={18} step={0.5} color={color}
          format={db} dim={automated.has('eqMid')} onChange={(v) => setCh({ eqMid: v })} />
        <Row label="LO" value={ch.eqLow} min={-18} max={18} step={0.5} color={color}
          format={db} dim={automated.has('eqLow')} onChange={(v) => setCh({ eqLow: v })} />
      </div>

      {/* Sends */}
      <div className="flex flex-col gap-0.5">
        <span className="text-neutral-700 tracking-widest" style={{ fontSize: 8 }}>SEND</span>
        <Row label="RV" value={ch.sendReverb} min={0} max={1} step={0.01} color="#8b5cf6"
          format={pct} dim={automated.has('sendReverb')} onChange={(v) => setCh({ sendReverb: v })} />
        <Row label="DL" value={ch.sendDelay} min={0} max={1} step={0.01} color="#06b6d4"
          format={pct} dim={automated.has('sendDelay')} onChange={(v) => setCh({ sendDelay: v })} />
        <Row label="CH" value={ch.sendChorus} min={0} max={1} step={0.01} color="#22c55e"
          format={pct} dim={automated.has('sendChorus')} onChange={(v) => setCh({ sendChorus: v })} />
      </div>

      {/* Sidechain — ducks this track under the drum machine's kick */}
      <div className="flex flex-col gap-0.5">
        <span
          className="tracking-widest"
          style={{ fontSize: 8, color: ch.sidechain > 0.01 ? '#f97316' : '#404040' }}
          title="Duck this track whenever the drum machine's kick fires"
        >SIDECHAIN</span>
        <Row label="SC" value={ch.sidechain} min={0} max={1} step={0.01} color="#f97316"
          format={pct} onChange={(v) => setCh({ sidechain: v })} />
      </div>

      {/* Fader + meter */}
      <div className="flex items-end gap-1 mt-auto pt-1">
        <div className="flex gap-0.5">
          <VUMeter analyser={analyser} color={color} />
        </div>
        <div className="flex flex-col items-center flex-1">
          <input
            type="range" min={0} max={1.5} step={0.01}
            value={ch.gain}
            className="h-14"
            style={{ accentColor: color, writingMode: 'vertical-lr', direction: 'rtl' } as React.CSSProperties}
            title={`Fader: ${pct(ch.gain)}`}
            onChange={(e) => setCh({ gain: parseFloat(e.target.value) })}
          />
          <span
            className="font-mono"
            style={{ fontSize: 8, color: automated.has('volume') ? '#525252' : '#737373' }}
          >{Math.round(ch.gain * 100)}</span>
        </div>
      </div>

      {/* Pan */}
      <Row label="PAN" value={track.pan} min={-1} max={1} step={0.01} color={color}
        format={(v) => v === 0 ? 'C' : v > 0 ? `R${Math.round(v * 100)}` : `L${Math.round(-v * 100)}`}
        dim={automated.has('pan')}
        onChange={(v) => dispatch({ type: 'SEQ_SET_TRACK_PAN', tabId, pan: v })} />

      {/* Mute/Solo */}
      <div className="flex gap-0.5">
        <button
          onClick={() => dispatch({ type: 'MUTE_TAB', id: tab.id, muted: !tab.isMuted })}
          className={`flex-1 h-4 text-xs font-bold border leading-none transition-colors ${
            tab.isMuted ? 'border-yellow-500 text-yellow-400 bg-yellow-900/30' : 'border-neutral-700 text-neutral-600 hover:text-neutral-400'
          }`}
        >M</button>
        <button
          onClick={() => dispatch({ type: 'SOLO_TAB', id: tab.id, solo: !tab.solo })}
          style={tab.solo ? { borderColor: color, color, backgroundColor: color + '22' } : {}}
          className={`flex-1 h-4 text-xs font-bold border leading-none transition-colors ${
            !tab.solo ? 'border-neutral-700 text-neutral-600 hover:text-neutral-400' : ''
          }`}
        >S</button>
      </div>
    </div>
  );
}

// ─── Mixer panel ──────────────────────────────────────────────────────────────

export function Mixer() {
  const { state, dispatch } = useAppStore();
  const activeTab = state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0];
  const accent = THEME_COLORS[activeTab.advanced.colorTheme];

  return (
    <div className="flex border-t border-neutral-800 bg-neutral-950 shrink-0 overflow-x-auto">
      {/* Master strip */}
      <div className="flex flex-col items-center gap-1 px-2 py-1.5 border-r border-neutral-700 w-[72px] shrink-0">
        <span className="text-xs font-mono text-neutral-400">MASTER</span>
        <div className="w-1.5 h-1.5 rounded-full bg-neutral-400" />
        <div className="flex flex-col items-center mt-auto">
          <input
            type="range" min={0} max={1} step={0.01}
            value={state.masterVolume}
            className="h-28"
            style={{ accentColor: accent, writingMode: 'vertical-lr', direction: 'rtl' } as React.CSSProperties}
            onChange={(e) => dispatch({ type: 'SET_MASTER_VOLUME', volume: parseFloat(e.target.value) })}
          />
          <span className="text-xs text-neutral-600 font-mono">{Math.round(state.masterVolume * 100)}</span>
        </div>
      </div>

      {/* Per-tab channel strips */}
      {state.tabs.map((tab) => (
        <ChannelStrip key={tab.id} tabId={tab.id} />
      ))}

      <div className="px-2 py-1.5 text-neutral-700 max-w-[140px] leading-tight" style={{ fontSize: 9 }}>
        Dimmed labels are driven by an automation lane and ignore the control here.
      </div>
    </div>
  );
}
