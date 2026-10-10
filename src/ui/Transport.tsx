import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore, useAccent } from '../store/appStore';
import { useDrumStore } from '../store/drumStore';
import { getSequencerEngine } from '../engine/sequencer';
import { getRecorder } from '../engine/pcmRecorder';
import { getPlayhead, setPlayhead, usePlayhead } from '../engine/playhead';
import { beatsToSeconds } from '../utils/music';
import { openExport, setLastTake, useExportState } from './exportState';
import { notify } from './notices';
import { getSettings } from '../store/settings';
import { withShortcut } from './shortcuts';
import { useHistory } from './useHistory';
import { ContextMenu, type MenuItem } from './ContextMenu';

// ─── Transport control hook (shared by the bar and keyboard shortcuts) ────────

export function useTransport() {
  const { state, dispatch } = useAppStore();
  const { state: drumState } = useDrumStore();
  const seq = state.sequencer;

  // Latest inputs in a ref so callbacks stay stable for global shortcuts
  const ref = useRef({ seq, tabs: state.tabs, drumPatterns: drumState.patterns });
  ref.current = { seq, tabs: state.tabs, drumPatterns: drumState.patterns };

  const play = useCallback(async (fromBeat?: number) => {
    const s = ref.current.seq;
    const start = fromBeat ?? s.playheadBeat;
    // Count-in (Settings) when starting with the metronome on — not on a seek
    const countInBeats = !s.isPlaying && s.metronome ? getSettings().countIn * s.beatsPerBar : 0;
    try {
      dispatch({ type: 'SEQ_SET_PLAYING', playing: true });
      setPlayhead(start);
      await getSequencerEngine().play(start, ref.current, { countInBeats });
    } catch (err) {
      console.error('Playback failed to start:', err);
      dispatch({ type: 'SEQ_SET_PLAYING', playing: false });
      notify('Audio could not start. Click anywhere on the page and try again.', 'error');
    }
  }, [dispatch]);

  /** Stop where we are, so the next play continues from here. */
  const stop = useCallback(() => {
    const at = getSequencerEngine().position() ?? getPlayhead();
    getSequencerEngine().stop();
    dispatch({ type: 'SEQ_SET_PLAYING', playing: false });
    dispatch({ type: 'SEQ_SET_PLAYHEAD', beat: at });
    setPlayhead(at);
  }, [dispatch]);

  const toggle = useCallback(() => {
    if (ref.current.seq.isPlaying) stop(); else void play();
  }, [play, stop]);

  /** Move the playhead; restarts from there if already playing. */
  const seek = useCallback((beat: number) => {
    const b = Math.max(0, beat);
    dispatch({ type: 'SEQ_SET_PLAYHEAD', beat: b });
    setPlayhead(b);
    if (ref.current.seq.isPlaying) void play(b);
  }, [dispatch, play]);

  const returnToStart = useCallback(() => {
    const s = ref.current.seq;
    // First press goes to the loop start if we're past it, second to zero
    const here = getPlayhead();
    const target = s.loopEnabled && here > s.loopStartBeat + 0.01 ? s.loopStartBeat : 0;
    seek(target);
  }, [seek]);

  return { play, stop, toggle, seek, returnToStart };
}

// ─── Position readout ─────────────────────────────────────────────────────────

function Position({ bpm, beatsPerBar }: { bpm: number; beatsPerBar: number }) {
  const beat = usePlayhead();
  const b = Math.max(0, beat);
  const bar = Math.floor(b / beatsPerBar) + 1;
  const inBar = Math.floor(b % beatsPerBar) + 1;
  const sixteenth = Math.floor((b % 1) * 4) + 1;
  const secs = beatsToSeconds(b, bpm);
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  const t = Math.floor((secs * 10) % 10);
  return (
    <div className="flex items-baseline gap-2 font-mono bg-neutral-950 border border-neutral-800 px-2 py-0.5 min-w-[72px] xl:min-w-[150px]" aria-label="Song position">
      <span className="text-sm text-neutral-100 tabular-nums">
        {bar}.{inBar}.{sixteenth}
      </span>
      <span className="hidden xl:inline text-xs text-neutral-500 tabular-nums">{m}:{String(s).padStart(2, '0')}.{t}</span>
    </div>
  );
}

// ─── Recording ────────────────────────────────────────────────────────────────

/**
 * Live recording of the master output, captured as raw PCM so the take is
 * lossless. Stopping opens the export dialog with the take, where it can be
 * saved as WAV (16/24/32-bit) or MP3 — and saved again in another format.
 */
function RecordButton({ onStartTransport, isPlaying }: { onStartTransport: () => void; isPlaying: boolean }) {
  const { state, dispatch } = useAppStore();
  const { take } = useExportState();
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!state.isRecording) return;
    setElapsed(0);
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [state.isRecording]);

  const stopRecording = useCallback(async () => {
    if (!getRecorder().isRecording) return;
    setBusy(true);
    try {
      const pcm = await getRecorder().stop();
      setLastTake(pcm);
      openExport('take');
    } catch (err) {
      notify('Recording failed to stop cleanly.', 'error');
      console.error(err);
    } finally {
      setBusy(false);
      dispatch({ type: 'SET_RECORDING', recording: false });
    }
  }, [dispatch]);

  // Stopping the transport ends the take, so a recording never trails into silence
  const wasPlaying = useRef(isPlaying);
  useEffect(() => {
    if (wasPlaying.current && !isPlaying && state.isRecording) void stopRecording();
    wasPlaying.current = isPlaying;
  }, [isPlaying, state.isRecording, stopRecording]);

  const toggle = async () => {
    if (state.isRecording) { await stopRecording(); return; }
    try {
      await getRecorder().start();
    } catch (err) {
      console.error(err);
      notify('This browser can’t record audio here.', 'error');
      return;
    }
    dispatch({ type: 'SET_RECORDING', recording: true });
    if (!isPlaying) onStartTransport();
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={toggle}
        disabled={busy}
        title="Record the master output live, losslessly (starts playback if stopped)"
        aria-label={state.isRecording ? `Stop recording ${fmt(elapsed)}` : 'Record'}
        className={`flex items-center gap-1.5 px-2 py-1 text-xs font-bold border tracking-widest transition-colors disabled:opacity-40 ${
          state.isRecording
            ? 'border-red-500 text-red-300 bg-red-900/30 animate-pulse'
            : 'border-neutral-700 text-neutral-400 hover:border-red-700 hover:text-red-300'
        }`}
      >
        <span className={`w-2 h-2 rounded-full ${state.isRecording ? 'bg-red-500' : 'bg-red-900'}`} />
        {state.isRecording ? fmt(elapsed) : <span className="hidden min-[1600px]:inline">REC</span>}
      </button>
      {take && !state.isRecording && (
        <button
          onClick={() => openExport('take')}
          className="px-1.5 py-1 text-xs border border-neutral-700 text-neutral-400 hover:text-neutral-100"
          title="Export the last recording"
          aria-label="Export the last recording"
        >↓<span className="hidden min-[1600px]:inline"> TAKE</span></button>
      )}
    </div>
  );
}

// ─── Transport bar ────────────────────────────────────────────────────────────

/**
 * The History list: edits that can be redone at the top (furthest first),
 * then the ones that can be undone, newest first. Choosing an edit undoes
 * back to just before it — or redoes up to and including it.
 */
function historyItems(h: ReturnType<typeof useHistory>): MenuItem[] {
  const redo: MenuItem[] = h.redoStack.map((e, i) => ({
    label: `↷ ${e.label ?? 'Edit'}`, dim: true,
    onSelect: () => { h.redo(i + 1); },
  })).reverse();
  const undo: MenuItem[] = [...h.undoStack].reverse().map((e, i) => ({
    label: `↶ ${e.label ?? 'Edit'}`,
    onSelect: () => { h.undo(i + 1); },
  }));
  return [...redo, { label: '● Now', disabled: true }, ...undo];
}

export function Transport() {
  const { state, dispatch } = useAppStore();
  const accent = useAccent();
  const seq = state.sequencer;
  const { toggle, stop, returnToStart, play } = useTransport();
  const history = useHistory();
  const [historyMenu, setHistoryMenu] = useState<{ x: number; y: number } | null>(null);
  const [bpmText, setBpmText] = useState(String(seq.bpm));

  useEffect(() => { setBpmText(String(seq.bpm)); }, [seq.bpm]);

  const commitBpm = () => {
    const v = parseFloat(bpmText);
    if (Number.isFinite(v)) dispatch({ type: 'SEQ_SET_BPM', bpm: v });
    else setBpmText(String(seq.bpm));
  };

  const btn = 'px-2 py-1 text-xs border transition-colors';
  const off = 'border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-neutral-200';
  const on = { borderColor: accent, color: accent, backgroundColor: accent + '18' };

  return (
    <div className="flex items-center gap-1.5 min-[1600px]:gap-2 whitespace-nowrap">
      <div className="flex gap-0.5">
        <button onClick={returnToStart} className={`${btn} ${off}`} title={withShortcut('Return to start (loop start first)', 'transport.home')} aria-label="Return to start">⏮</button>
        <button
          onClick={toggle}
          className={`${btn} px-3 font-bold tracking-widest min-w-[64px]`}
          style={seq.isPlaying ? { borderColor: '#ef4444', color: '#fca5a5', backgroundColor: '#7f1d1d33' } : on}
          title={withShortcut('Play / stop', 'transport.toggle')}
          data-tour="play"
        >
          {seq.isPlaying ? '■ STOP' : '▶ PLAY'}
        </button>
        <button
          onClick={() => { if (seq.isPlaying) stop(); else returnToStart(); }}
          className={`${btn} ${off}`}
          title="Stop; when stopped, return to start"
          aria-label="Stop"
        >⏹</button>
      </div>

      <div className="flex gap-0.5" role="group" aria-label="History">
        <button
          onClick={() => history.undo()}
          onContextMenu={(e) => { e.preventDefault(); setHistoryMenu({ x: e.clientX, y: e.clientY }); }}
          disabled={!history.undoName}
          className={`${btn} ${off} disabled:opacity-30 disabled:pointer-events-none`}
          title={history.undoName ? withShortcut(`Undo ${history.undoName}`, 'edit.undo') : 'Nothing to undo'}
          aria-label={history.undoName ? `Undo ${history.undoName}` : 'Undo'}
        >↶</button>
        <button
          onClick={() => history.redo()}
          disabled={!history.redoName}
          className={`${btn} ${off} disabled:opacity-30 disabled:pointer-events-none`}
          title={history.redoName ? withShortcut(`Redo ${history.redoName}`, 'edit.redo') : 'Nothing to redo'}
          aria-label={history.redoName ? `Redo ${history.redoName}` : 'Redo'}
        >↷</button>
        <button
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHistoryMenu({ x: r.left, y: r.bottom + 2 }); }}
          disabled={!history.undoName && !history.redoName}
          className={`px-1 py-1 text-xs border ${off} disabled:opacity-30 disabled:pointer-events-none`}
          title="History — jump back or forward several steps"
          aria-label="History"
          data-testid="history-button"
        >▾</button>
      </div>
      {historyMenu && (
        <ContextMenu
          x={historyMenu.x} y={historyMenu.y} title="History" scroll
          items={historyItems(history)}
          onClose={() => setHistoryMenu(null)}
        />
      )}

      <RecordButton onStartTransport={() => void play()} isPlaying={seq.isPlaying} />
      <button
        onClick={() => openExport('song')}
        className={`${btn} ${off} tracking-widest`}
        title={withShortcut('Export the arrangement — WAV, MP3, stems or MIDI', 'file.export')}
        aria-label="Export"
        data-tour="export"
      >⤓<span className="hidden min-[1600px]:inline"> EXPORT</span></button>

      <Position bpm={seq.bpm} beatsPerBar={seq.beatsPerBar} />

      <label className="flex items-center gap-1" title="Tempo">
        <span className="hidden min-[1600px]:inline text-xs text-neutral-500 tracking-widest">BPM</span>
        <input
          type="text" inputMode="decimal" value={bpmText}
          aria-label="Tempo in BPM"
          onChange={(e) => setBpmText(e.target.value)}
          onBlur={commitBpm}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              dispatch({ type: 'SEQ_SET_BPM', bpm: seq.bpm + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1) });
            }
          }}
          className="w-12 bg-neutral-950 border border-neutral-700 text-xs text-neutral-100 font-mono text-center px-1 py-0.5 focus:outline-hidden focus:border-neutral-400"
        />
      </label>

      <label className="flex items-center gap-1" title="Beats per bar">
        <select
          value={seq.beatsPerBar}
          onChange={(e) => dispatch({ type: 'SEQ_SET_BEATS_PER_BAR', bpb: parseInt(e.target.value, 10) })}
          aria-label="Beats per bar"
          className="bg-neutral-950 border border-neutral-700 text-xs text-neutral-200 px-1 py-0.5"
        >
          {[2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}/4</option>)}
        </select>
      </label>

      <button
        onClick={() => dispatch({ type: 'SEQ_SET_LOOP', enabled: !seq.loopEnabled })}
        className={`${btn} tracking-widest ${seq.loopEnabled ? '' : off}`}
        style={seq.loopEnabled ? on : {}}
        title={`${withShortcut('Loop the range shown on the ruler', 'transport.loop')}. Drag on the ruler to set it.`}
        aria-label="Loop"
        aria-pressed={seq.loopEnabled}
      >↻<span className="hidden min-[1600px]:inline"> LOOP</span></button>

      <button
        onClick={() => dispatch({ type: 'SEQ_TOGGLE_METRONOME' })}
        className={`${btn} tracking-widest ${seq.metronome ? '' : off}`}
        style={seq.metronome ? on : {}}
        title={withShortcut('Metronome click', 'transport.metronome')}
        aria-label="Metronome"
        aria-pressed={seq.metronome}
      >♩<span className="hidden min-[1600px]:inline"> CLICK</span></button>
    </div>
  );
}
