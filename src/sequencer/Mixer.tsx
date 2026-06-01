import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { getAudioEngine } from '../engine/audio';
import { THEME_COLORS } from '../utils/math';

// ─── VU Meter canvas ──────────────────────────────────────────────────────────

function VUMeter({ analyser, color }: { analyser: AnalyserNode | null; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const buf = new Float32Array(analyser.fftSize);

    const draw = () => {
      analyser.getFloatTimeDomainData(buf);
      let rms = 0;
      for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
      rms = Math.sqrt(rms / buf.length);
      const db = 20 * Math.log10(Math.max(rms, 1e-6));
      const level = Math.max(0, Math.min(1, (db + 60) / 60)); // -60dB to 0dB

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

  return <canvas ref={canvasRef} width={8} height={60} className="rounded-sm" />;
}

// ─── Channel strip ────────────────────────────────────────────────────────────

function ChannelStrip({ tabId }: { tabId: string }) {
  const { state, dispatch } = useAppStore();
  const tab = state.tabs.find((t) => t.id === tabId);
  const track = state.sequencer.tracks.find((t) => t.tabId === tabId);
  const analyserRef = useRef<AnalyserNode | null>(null);

  useEffect(() => {
    const ctx = getAudioEngine().getAudioContext();
    if (!ctx) return;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyserRef.current = analyser;
    // In a full impl, connect after the tab's gain node. Here we approximate by connecting master.
    return () => { try { analyser.disconnect(); } catch (_) { /* ignore */ } };
  }, [tabId]);

  if (!tab || !track) return null;
  const color = tab.color;

  return (
    <div className="flex flex-col items-center gap-1.5 px-2 py-2 border-r border-neutral-800 min-w-[60px]">
      {/* Label */}
      <span className="text-xs font-mono text-neutral-400 truncate max-w-[50px] text-center">{tab.label}</span>
      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />

      {/* VU meters */}
      <div className="flex gap-0.5">
        <VUMeter analyser={analyserRef.current} color={color} />
        <VUMeter analyser={analyserRef.current} color={color} />
      </div>

      {/* Volume fader */}
      <div className="flex flex-col items-center">
        <input
          type="range" min={0} max={1} step={0.01}
          value={tab.oscillator.masterVolume}
          className="h-20"
          style={{ accentColor: color, writingMode: 'vertical-lr', direction: 'rtl' } as React.CSSProperties}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            dispatch({
              type: 'UPDATE_TAB_OSC',
              id: tab.id,
              oscillator: { ...tab.oscillator, masterVolume: v },
            });
            if (tab.isPlaying) getAudioEngine().updateTab(tab.id, { ...tab.oscillator, masterVolume: v }, tab.advanced);
          }}
        />
        <span className="text-xs text-neutral-600 font-mono">{Math.round(tab.oscillator.masterVolume * 100)}</span>
      </div>

      {/* Pan */}
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-neutral-600" style={{ fontSize: 8 }}>PAN</span>
        <input
          type="range" min={-1} max={1} step={0.01}
          value={track.pan}
          className="w-12"
          style={{ accentColor: color }}
          onChange={(e) => dispatch({ type: 'SEQ_SET_TRACK_PAN', tabId: tab.id, pan: parseFloat(e.target.value) })}
        />
        <span className="font-mono text-neutral-600" style={{ fontSize: 8 }}>
          {track.pan === 0 ? 'C' : track.pan > 0 ? `R${Math.round(track.pan * 100)}` : `L${Math.round(-track.pan * 100)}`}
        </span>
      </div>

      {/* Mute/Solo */}
      <div className="flex gap-0.5">
        <button
          onClick={() => dispatch({ type: 'MUTE_TAB', id: tab.id, muted: !tab.isMuted })}
          className={`w-5 h-5 text-xs font-bold border leading-none transition-colors ${
            tab.isMuted ? 'border-yellow-500 text-yellow-400 bg-yellow-900/30' : 'border-neutral-700 text-neutral-600 hover:text-neutral-400'
          }`}
        >M</button>
        <button
          onClick={() => dispatch({ type: 'SOLO_TAB', id: tab.id, solo: !tab.solo })}
          style={tab.solo ? { borderColor: color, color, backgroundColor: color + '22' } : {}}
          className={`w-5 h-5 text-xs font-bold border leading-none transition-colors ${
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
      <div className="flex flex-col items-center gap-1.5 px-2 py-2 border-r border-neutral-700 min-w-[60px]">
        <span className="text-xs font-mono text-neutral-400">MASTER</span>
        <div className="w-2 h-2 rounded-full bg-neutral-400" />
        <div className="flex flex-col items-center">
          <input
            type="range" min={0} max={1} step={0.01}
            value={state.masterVolume}
            className="h-20"
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
    </div>
  );
}
