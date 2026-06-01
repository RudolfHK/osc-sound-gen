import { useAppStore } from '../store/appStore';
import { KEY_W } from '../utils/music';
import type { OscillatorTab } from '../engine/oscillator';
import type { SequencerTrack } from '../utils/music';

interface TrackHeaderProps {
  tab: OscillatorTab;
  track: SequencerTrack;
  height: number;
}

export function TrackHeader({ tab, track, height }: TrackHeaderProps) {
  const { dispatch } = useAppStore();

  return (
    <div
      className="flex items-center gap-1.5 px-2 border-b border-neutral-800 border-r border-r-neutral-700 shrink-0"
      style={{ width: KEY_W + 52, minHeight: height, backgroundColor: '#111' }}
    >
      {/* Color bar */}
      <div className="w-1 self-stretch rounded-full shrink-0" style={{ backgroundColor: tab.color }} />

      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <span className="text-xs font-mono text-neutral-300 truncate" title={tab.label}>{tab.label}</span>
        <span className="text-xs text-neutral-600">{tab.oscillator.waveform} {tab.oscillator.frequency.toFixed(0)}Hz</span>
      </div>

      <div className="flex flex-col gap-0.5 shrink-0">
        {/* Mute */}
        <button
          onClick={() => dispatch({ type: 'MUTE_TAB', id: tab.id, muted: !tab.isMuted })}
          title={tab.isMuted ? 'Unmute' : 'Mute'}
          className={`w-5 h-4 text-xs font-bold border leading-none transition-colors ${
            tab.isMuted
              ? 'border-yellow-500 text-yellow-400 bg-yellow-900/30'
              : 'border-neutral-700 text-neutral-600 hover:border-neutral-500 hover:text-neutral-400'
          }`}
        >
          M
        </button>
        {/* Solo */}
        <button
          onClick={() => dispatch({ type: 'SOLO_TAB', id: tab.id, solo: !tab.solo })}
          title={tab.solo ? 'Unsolo' : 'Solo'}
          style={tab.solo ? { borderColor: tab.color, color: tab.color, backgroundColor: tab.color + '22' } : {}}
          className={`w-5 h-4 text-xs font-bold border leading-none transition-colors ${
            !tab.solo ? 'border-neutral-700 text-neutral-600 hover:border-neutral-500 hover:text-neutral-400' : ''
          }`}
        >
          S
        </button>
      </div>

      {/* Pan knob (simple slider) */}
      <div className="flex flex-col items-center shrink-0">
        <span className="text-neutral-600" style={{ fontSize: 8 }}>PAN</span>
        <input
          type="range" min={-1} max={1} step={0.01} value={track.pan}
          className="w-10"
          style={{ accentColor: tab.color, writingMode: 'horizontal-tb' }}
          title={`Pan: ${track.pan >= 0 ? '+' : ''}${track.pan.toFixed(2)}`}
          onChange={(e) => dispatch({ type: 'SEQ_SET_TRACK_PAN', tabId: tab.id, pan: parseFloat(e.target.value) })}
        />
      </div>

      {/* Clear track */}
      <button
        onClick={() => {
          dispatch({ type: 'SEQ_PUSH_UNDO' });
          dispatch({ type: 'SEQ_CLEAR_TRACK', tabId: tab.id });
        }}
        title="Clear all notes on this track"
        className="text-neutral-700 hover:text-red-400 transition-colors text-xs"
      >
        ✕
      </button>
    </div>
  );
}
