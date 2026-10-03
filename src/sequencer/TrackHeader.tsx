import { useAppStore } from '../store/appStore';
import { KEY_W, SNAP_OPTIONS, ARP_MODES } from '../utils/music';
import type { OscillatorTab } from '../engine/oscillator';
import type { SequencerTrack, SnapValue, ArpMode } from '../utils/music';

interface TrackHeaderProps {
  tab: OscillatorTab;
  track: SequencerTrack;
  height: number;
}

export function TrackHeader({ tab, track, height }: TrackHeaderProps) {
  const { dispatch } = useAppStore();
  const arp = track.arp;

  return (
    <div
      className="flex flex-col border-b border-neutral-800 border-r border-r-neutral-700 shrink-0 overflow-hidden"
      style={{ width: KEY_W + 52, minHeight: height, backgroundColor: '#111' }}
    >
      {/* ── Identity row ── */}
      <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-1">
        <div className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: tab.color }} />

        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <span className="text-xs font-mono text-neutral-300 truncate" title={tab.label}>{tab.label}</span>
          <span className="text-neutral-600 truncate" style={{ fontSize: 9 }}>
            {tab.oscillator.waveform} {tab.oscillator.frequency.toFixed(0)}Hz
          </span>
        </div>

        <div className="flex flex-col gap-0.5 shrink-0">
          <button
            onClick={() => dispatch({ type: 'MUTE_TAB', id: tab.id, muted: !tab.isMuted })}
            title={tab.isMuted ? 'Unmute' : 'Mute'}
            className={`w-5 h-4 text-xs font-bold border leading-none transition-colors ${
              tab.isMuted
                ? 'border-yellow-500 text-yellow-400 bg-yellow-900/30'
                : 'border-neutral-700 text-neutral-600 hover:border-neutral-500 hover:text-neutral-400'
            }`}
          >M</button>
          <button
            onClick={() => dispatch({ type: 'SOLO_TAB', id: tab.id, solo: !tab.solo })}
            title={tab.solo ? 'Unsolo' : 'Solo'}
            style={tab.solo ? { borderColor: tab.color, color: tab.color, backgroundColor: tab.color + '22' } : {}}
            className={`w-5 h-4 text-xs font-bold border leading-none transition-colors ${
              !tab.solo ? 'border-neutral-700 text-neutral-600 hover:border-neutral-500 hover:text-neutral-400' : ''
            }`}
          >S</button>
        </div>

        <button
          onClick={() => {
            dispatch({ type: 'SEQ_PUSH_UNDO' });
            dispatch({ type: 'SEQ_CLEAR_TRACK', tabId: tab.id });
          }}
          title="Clear all notes on this track"
          className="text-neutral-700 hover:text-red-400 transition-colors text-xs self-start"
        >✕</button>
      </div>

      {/* ── Pan ── */}
      <div className="flex items-center gap-1.5 px-2 pb-1">
        <span className="text-neutral-600 shrink-0" style={{ fontSize: 9 }}>PAN</span>
        <input
          type="range" min={-1} max={1} step={0.01} value={track.pan}
          className="flex-1 h-1"
          style={{ accentColor: tab.color }}
          title={`Pan: ${track.pan >= 0 ? '+' : ''}${track.pan.toFixed(2)}`}
          onChange={(e) => dispatch({ type: 'SEQ_SET_TRACK_PAN', tabId: tab.id, pan: parseFloat(e.target.value) })}
        />
        <span className="font-mono text-neutral-600 shrink-0 w-6 text-right" style={{ fontSize: 9 }}>
          {track.pan === 0 ? 'C' : track.pan > 0 ? `R${Math.round(track.pan * 100)}` : `L${Math.round(-track.pan * 100)}`}
        </span>
      </div>

      {/* ── Arpeggiator ──
          Held chords become running patterns, which is how driving electronic
          parts get written without drawing every sixteenth by hand. */}
      <div
        className="mt-auto px-2 py-1 border-t border-neutral-800/60"
        style={{ backgroundColor: arp.enabled ? tab.color + '0e' : 'transparent' }}
      >
        <div className="flex items-center gap-1 mb-1">
          <button
            onClick={() => dispatch({ type: 'SEQ_SET_ARP', tabId: tab.id, arp: { enabled: !arp.enabled } })}
            className="px-1.5 py-0.5 text-xs border tracking-widest transition-colors"
            style={arp.enabled
              ? { borderColor: tab.color, color: tab.color, backgroundColor: tab.color + '22' }
              : { borderColor: '#404040', color: '#737373' }}
            title="Expand held chords into an arpeggio"
          >
            ARP
          </button>
          {arp.enabled && (
            <>
              <select
                value={arp.rate}
                onChange={(e) => dispatch({ type: 'SEQ_SET_ARP', tabId: tab.id, arp: { rate: e.target.value as SnapValue } })}
                className="bg-neutral-900 border border-neutral-700 text-neutral-300 px-0.5"
                style={{ fontSize: 9 }}
                title="Step length"
              >
                {SNAP_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <select
                value={arp.mode}
                onChange={(e) => dispatch({ type: 'SEQ_SET_ARP', tabId: tab.id, arp: { mode: e.target.value as ArpMode } })}
                className="bg-neutral-900 border border-neutral-700 text-neutral-300 px-0.5 flex-1 min-w-0"
                style={{ fontSize: 9 }}
                title="Direction"
              >
                {ARP_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </>
          )}
        </div>

        {arp.enabled && (
          <div className="flex items-center gap-1.5">
            <span className="text-neutral-600 shrink-0" style={{ fontSize: 9 }}>OCT</span>
            <input
              type="range" min={1} max={4} step={1} value={arp.octaves}
              className="w-9 h-1" style={{ accentColor: tab.color }}
              title={`Octave range: ${arp.octaves}`}
              onChange={(e) => dispatch({ type: 'SEQ_SET_ARP', tabId: tab.id, arp: { octaves: +e.target.value } })}
            />
            <span className="font-mono text-neutral-600 shrink-0" style={{ fontSize: 9 }}>{arp.octaves}</span>
            <span className="text-neutral-600 shrink-0 ml-0.5" style={{ fontSize: 9 }}>GATE</span>
            <input
              type="range" min={0.05} max={1} step={0.05} value={arp.gate}
              className="w-9 h-1" style={{ accentColor: tab.color }}
              title={`Gate: ${Math.round(arp.gate * 100)}% of each step`}
              onChange={(e) => dispatch({ type: 'SEQ_SET_ARP', tabId: tab.id, arp: { gate: +e.target.value } })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
