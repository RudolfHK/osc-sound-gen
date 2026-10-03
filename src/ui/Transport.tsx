import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore, useAccent } from '../store/appStore';
import { useDrumStore } from '../store/drumStore';
import { getSequencerEngine } from '../engine/sequencer';
import { getAudioEngine } from '../engine/audio';
import { RecordingEngine } from '../engine/recording';
import { getPlayhead, setPlayhead, usePlayhead } from '../engine/playhead';
import { beatsToSeconds } from '../utils/music';
import { downloadBlob, blobToWAV } from '../utils/wav';
import { notify } from './notices';

// ─── Transport control hook (shared by the bar and keyboard shortcuts) ────────

export function useTransport() {
  const { state, dispatch } = useAppStore();
  const { state: drumState } = useDrumStore();
  const seq = state.sequencer;

  // Latest inputs in a ref so callbacks stay stable for global shortcuts
  const ref = useRef({ seq, tabs: state.tabs, drumPatterns: drumState.patterns });
  ref.current = { seq, tabs: state.tabs, drumPatterns: drumState.patterns };

  const play = useCallback(async (fromBeat?: number) => {
    const start = fromBeat ?? ref.current.seq.playheadBeat;
    try {
      dispatch({ type: 'SEQ_SET_PLAYING', playing: true });
      setPlayhead(start);
      await getSequencerEngine().play(start, ref.current);
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
    <div className="flex items-baseline gap-2 font-mono bg-neutral-950 border border-neutral-800 px-2 py-0.5 min-w-[150px]" aria-label="Song position">
      <span className="text-sm text-neutral-100 tabular-nums">
        {bar}.{inBar}.{sixteenth}
      </span>
      <span className="text-xs text-neutral-500 tabular-nums">{m}:{String(s).padStart(2, '0')}.{t}</span>
    </div>
  );
}

// ─── Recording ────────────────────────────────────────────────────────────────

function RecordButton({ onStartTransport, isPlaying }: { onStartTransport: () => void; isPlaying: boolean }) {
  const { state, dispatch } = useAppStore();
  const engineRef = useRef<RecordingEngine | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [last, setLast] = useState<{ blob: Blob; timestamp: string; mimeType: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!state.isRecording) return;
    setElapsed(0);
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [state.isRecording]);

  const stopRecording = useCallback(async () => {
    const eng = engineRef.current;
    if (!eng) return;
    setBusy(true);
    try {
      const rec = await eng.stop();
      setLast({ blob: rec.blob, timestamp: rec.timestamp, mimeType: rec.mimeType });
      notify('Recording ready — download it from the REC menu.');
    } catch (err) {
      notify('Recording failed to stop cleanly.', 'error');
      console.error(err);
    } finally {
      setBusy(false);
      engineRef.current = null;
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
    if (typeof MediaRecorder === 'undefined') {
      notify('This browser can’t record audio.', 'error');
      return;
    }
    // Create the audio graph on demand rather than asking the user to play first
    await getAudioEngine().getOrCreateAudioContext();
    const dest = getAudioEngine().getMediaStreamDest();
    if (!dest) { notify('Audio output is unavailable.', 'error'); return; }
    const eng = new RecordingEngine(dest);
    eng.start();
    engineRef.current = eng;
    setLast(null);
    dispatch({ type: 'SET_RECORDING', recording: true });
    if (!isPlaying) onStartTransport();
  };

  const download = async (kind: 'webm' | 'wav') => {
    if (!last) return;
    if (kind === 'webm') {
      const ext = last.mimeType.includes('ogg') ? 'ogg' : last.mimeType.includes('mp4') ? 'mp4' : 'webm';
      downloadBlob(last.blob, `${state.projectName}-${last.timestamp}.${ext}`);
      return;
    }
    const ctx = getAudioEngine().getAudioContext();
    if (!ctx) return;
    setBusy(true);
    try {
      downloadBlob(await blobToWAV(last.blob, ctx), `${state.projectName}-${last.timestamp}.wav`);
    } catch (err) {
      notify('WAV conversion failed — the WebM download still works.', 'error');
      console.error(err);
    } finally {
      setBusy(false);
    }
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={toggle}
        disabled={busy}
        title="Record the master output (starts playback if stopped)"
        className={`flex items-center gap-1.5 px-2 py-1 text-xs font-bold border tracking-widest transition-colors disabled:opacity-40 ${
          state.isRecording
            ? 'border-red-500 text-red-300 bg-red-900/30 animate-pulse'
            : 'border-neutral-700 text-neutral-400 hover:border-red-700 hover:text-red-300'
        }`}
      >
        <span className={`w-2 h-2 rounded-full ${state.isRecording ? 'bg-red-500' : 'bg-red-900'}`} />
        {state.isRecording ? fmt(elapsed) : 'REC'}
      </button>
      {last && !state.isRecording && (
        <>
          <button onClick={() => download('wav')} disabled={busy}
            className="px-1.5 py-1 text-xs border border-neutral-700 text-neutral-400 hover:text-neutral-100 disabled:opacity-40">
            ↓ WAV
          </button>
          <button onClick={() => download('webm')} disabled={busy}
            className="px-1.5 py-1 text-xs border border-neutral-700 text-neutral-500 hover:text-neutral-100 disabled:opacity-40">
            ↓ WebM
          </button>
        </>
      )}
    </div>
  );
}

// ─── Transport bar ────────────────────────────────────────────────────────────

export function Transport() {
  const { state, dispatch } = useAppStore();
  const accent = useAccent();
  const seq = state.sequencer;
  const { toggle, stop, returnToStart, play } = useTransport();
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
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex gap-0.5">
        <button onClick={returnToStart} className={`${btn} ${off}`} title="Return to start (Home)">⏮</button>
        <button
          onClick={toggle}
          className={`${btn} px-3 font-bold tracking-widest min-w-[64px]`}
          style={seq.isPlaying ? { borderColor: '#ef4444', color: '#fca5a5', backgroundColor: '#7f1d1d33' } : on}
          title="Play / stop (Space)"
        >
          {seq.isPlaying ? '■ STOP' : '▶ PLAY'}
        </button>
        <button
          onClick={() => { if (seq.isPlaying) stop(); else returnToStart(); }}
          className={`${btn} ${off}`}
          title="Stop; when stopped, return to start"
        >⏹</button>
      </div>

      <RecordButton onStartTransport={() => void play()} isPlaying={seq.isPlaying} />

      <Position bpm={seq.bpm} beatsPerBar={seq.beatsPerBar} />

      <label className="flex items-center gap-1" title="Tempo">
        <span className="text-xs text-neutral-600 tracking-widest">BPM</span>
        <input
          type="text" inputMode="decimal" value={bpmText}
          onChange={(e) => setBpmText(e.target.value)}
          onBlur={commitBpm}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              dispatch({ type: 'SEQ_SET_BPM', bpm: seq.bpm + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1) });
            }
          }}
          className="w-12 bg-neutral-950 border border-neutral-700 text-xs text-neutral-100 font-mono text-center px-1 py-0.5 focus:outline-none focus:border-neutral-400"
        />
      </label>

      <label className="flex items-center gap-1" title="Beats per bar">
        <select
          value={seq.beatsPerBar}
          onChange={(e) => dispatch({ type: 'SEQ_SET_BEATS_PER_BAR', bpb: parseInt(e.target.value, 10) })}
          className="bg-neutral-950 border border-neutral-700 text-xs text-neutral-200 px-1 py-0.5"
        >
          {[2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}/4</option>)}
        </select>
      </label>

      <button
        onClick={() => dispatch({ type: 'SEQ_SET_LOOP', enabled: !seq.loopEnabled })}
        className={`${btn} tracking-widest ${seq.loopEnabled ? '' : off}`}
        style={seq.loopEnabled ? on : {}}
        title="Loop the range shown on the ruler (L). Drag on the ruler to set it."
      >↻ LOOP</button>

      <button
        onClick={() => dispatch({ type: 'SEQ_TOGGLE_METRONOME' })}
        className={`${btn} tracking-widest ${seq.metronome ? '' : off}`}
        style={seq.metronome ? on : {}}
        title="Metronome click (K)"
      >♩ CLICK</button>
    </div>
  );
}
