import { useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { getSequencerEngine } from '../engine/sequencer';
import { SNAP_OPTIONS, beatToBarBeat, formatBeatsAsTime } from '../utils/music';
import type { SnapValue } from '../utils/music';
import { THEME_COLORS } from '../utils/math';

export function TransportBar() {
  const { state, dispatch } = useAppStore();
  const seq = state.sequencer;
  const activeTab = state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0];
  const accent = THEME_COLORS[activeTab.advanced.colorTheme];

  const handlePlay = useCallback(async () => {
    if (seq.isPlaying) {
      getSequencerEngine().stop();
      dispatch({ type: 'SEQ_SET_PLAYING', playing: false });
    } else {
      try {
        dispatch({ type: 'SEQ_SET_PLAYING', playing: true });
        await getSequencerEngine().play(
          seq.playheadBeat,
          seq,
          state.tabs,
          (beat) => dispatch({ type: 'SEQ_SET_PLAYHEAD', beat }),
        );
      } catch (err) {
        console.error('Sequencer failed to start:', err);
        dispatch({ type: 'SEQ_SET_PLAYING', playing: false });
      }
    }
  }, [seq, state.tabs, dispatch]);

  const handleStop = useCallback(() => {
    getSequencerEngine().stop();
    dispatch({ type: 'SEQ_SET_PLAYING', playing: false });
    dispatch({ type: 'SEQ_SET_PLAYHEAD', beat: seq.loopEnabled ? seq.loopStartBeat : 0 });
  }, [seq, dispatch]);

  const handleRewind = useCallback(() => {
    dispatch({ type: 'SEQ_SET_PLAYHEAD', beat: 0 });
    if (seq.isPlaying) {
      getSequencerEngine().stop();
      dispatch({ type: 'SEQ_SET_PLAYING', playing: false });
    }
  }, [seq, dispatch]);

  const pos = beatToBarBeat(seq.playheadBeat, seq.beatsPerBar);
  const timeStr = formatBeatsAsTime(seq.playheadBeat, seq.bpm);

  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-neutral-800 bg-neutral-900/50 shrink-0 flex-wrap">
      {/* Transport buttons */}
      <div className="flex gap-1">
        <button
          onClick={handleRewind}
          className="px-2 py-1 text-xs border border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200 transition-colors"
          title="Rewind to start"
        >
          ⏮
        </button>
        <button
          onClick={handlePlay}
          style={seq.isPlaying ? {} : { borderColor: accent, color: accent }}
          className={`px-3 py-1 text-xs font-bold border tracking-widest transition-colors ${
            seq.isPlaying
              ? 'border-red-500 text-red-400 bg-red-900/20 hover:bg-red-900/40'
              : 'hover:opacity-80'
          }`}
        >
          {seq.isPlaying ? '■ STOP' : '▶ PLAY'}
        </button>
        <button
          onClick={handleStop}
          className="px-2 py-1 text-xs border border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200 transition-colors"
          title="Stop and reset"
        >
          ⏹
        </button>
      </div>

      {/* Position display */}
      <div className="font-mono text-xs text-neutral-300 bg-neutral-950 px-2 py-1 border border-neutral-800 min-w-[90px] text-center">
        {pos.bar}:{pos.beat} · {timeStr}
      </div>

      {/* BPM */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-neutral-600 tracking-widest">BPM</span>
        <input
          type="number" min={20} max={300} step={1} value={seq.bpm}
          className="w-16 bg-neutral-950 border border-neutral-700 text-xs text-neutral-200 font-mono text-center px-1 py-0.5 focus:outline-none focus:border-neutral-500"
          onChange={(e) => {
            const v = parseInt(e.target.value);
            if (!isNaN(v)) {
              dispatch({ type: 'SEQ_SET_BPM', bpm: v });
              if (seq.isPlaying) getSequencerEngine().updateState({ ...seq, bpm: v }, state.tabs);
            }
          }}
        />
      </div>

      {/* Beats per bar */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-neutral-600 tracking-widest">/BAR</span>
        <select
          value={seq.beatsPerBar}
          className="bg-neutral-950 border border-neutral-700 text-xs text-neutral-200 px-1 py-0.5 focus:outline-none"
          onChange={(e) => dispatch({ type: 'SEQ_SET_BEATS_PER_BAR', bpb: parseInt(e.target.value) })}
        >
          {[2, 3, 4, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {/* Snap */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-neutral-600 tracking-widest">SNAP</span>
        <select
          value={seq.snapValue}
          className="bg-neutral-950 border border-neutral-700 text-xs text-neutral-200 px-1 py-0.5 focus:outline-none"
          onChange={(e) => dispatch({ type: 'SEQ_SET_SNAP', snap: e.target.value as SnapValue })}
        >
          {SNAP_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Loop toggle */}
      <button
        onClick={() => dispatch({ type: 'SEQ_SET_LOOP', enabled: !seq.loopEnabled })}
        style={seq.loopEnabled ? { borderColor: accent, color: accent, backgroundColor: accent + '18' } : {}}
        className={`px-2 py-1 text-xs border tracking-widest transition-colors ${
          !seq.loopEnabled ? 'border-neutral-700 text-neutral-600 hover:border-neutral-500 hover:text-neutral-300' : ''
        }`}
      >
        ↻ LOOP
      </button>

      {/* Song length */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-neutral-600 tracking-widest">BARS</span>
        <input
          type="number" min={1} max={128} step={1} value={seq.songLengthBars}
          className="w-14 bg-neutral-950 border border-neutral-700 text-xs text-neutral-200 font-mono text-center px-1 py-0.5 focus:outline-none focus:border-neutral-500"
          onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) dispatch({ type: 'SEQ_SET_SONG_LENGTH', bars: v }); }}
        />
      </div>

      {/* Edit mode */}
      <div className="flex gap-0.5 ml-auto">
        {(['draw', 'select'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => dispatch({ type: 'SEQ_SET_EDIT_MODE', mode })}
            style={seq.editMode === mode ? { borderColor: accent, color: accent, backgroundColor: accent + '18' } : {}}
            className={`px-2 py-1 text-xs border tracking-widest transition-colors capitalize ${
              seq.editMode !== mode ? 'border-neutral-700 text-neutral-600 hover:border-neutral-500 hover:text-neutral-300' : ''
            }`}
          >
            {mode === 'draw' ? '✎ DRAW' : '⊹ SELECT'}
          </button>
        ))}
      </div>

      {/* Undo/Redo */}
      <div className="flex gap-0.5">
        <button
          onClick={() => dispatch({ type: 'SEQ_UNDO' })}
          disabled={seq.undoStack.length === 0}
          className="px-2 py-1 text-xs border border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300 transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          ↩
        </button>
        <button
          onClick={() => dispatch({ type: 'SEQ_REDO' })}
          disabled={seq.redoStack.length === 0}
          className="px-2 py-1 text-xs border border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300 transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          ↪
        </button>
      </div>
    </div>
  );
}
