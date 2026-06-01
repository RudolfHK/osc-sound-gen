import { useEffect, useRef, useState } from 'react';
import { RecordingEngine } from '../engine/recording';
import { getAudioEngine } from '../engine/audio';
import { downloadBlob, blobToWAV } from '../utils/wav';

interface RecordingControlsProps {
  isRecording: boolean;
  onSetRecording: (v: boolean) => void;
}

export function RecordingControls({ isRecording, onSetRecording }: RecordingControlsProps) {
  const engineRef = useRef<RecordingEngine | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [lastBlob, setLastBlob] = useState<{ blob: Blob; timestamp: string; mimeType: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isRecording) {
      setElapsed(0);
      intervalRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } else {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isRecording]);

  const handleToggle = async () => {
    const audioEngine = getAudioEngine();
    setError(null);
    if (isRecording) {
      const eng = engineRef.current;
      if (!eng) return;
      setBusy(true);
      try {
        const track = await eng.stop();
        setLastBlob({ blob: track.blob, timestamp: track.timestamp, mimeType: track.mimeType });
      } catch (err) {
        setError('Recording failed to stop cleanly.');
        console.error(err);
      } finally {
        setBusy(false);
        engineRef.current = null;
        onSetRecording(false);  // always clear recording state
      }
    } else {
      const dest = audioEngine.getMediaStreamDest();
      if (!dest) {
        // AudioContext doesn't exist yet — user must play audio first
        setError('Play at least one oscillator before recording.');
        return;
      }
      const eng = new RecordingEngine(dest);
      eng.start();
      engineRef.current = eng;
      setLastBlob(null);
      onSetRecording(true);
    }
  };

  const downloadWebM = () => {
    if (!lastBlob) return;
    const ext = lastBlob.mimeType.includes('ogg') ? 'ogg' : lastBlob.mimeType.includes('mp4') ? 'mp4' : 'webm';
    downloadBlob(lastBlob.blob, `osc-${lastBlob.timestamp}.${ext}`);
  };

  const downloadWAV = async () => {
    if (!lastBlob) return;
    const ctx = getAudioEngine().getAudioContext();
    if (!ctx) return;
    setBusy(true);
    try {
      const wav = await blobToWAV(lastBlob.blob, ctx);
      downloadBlob(wav, `osc-${lastBlob.timestamp}.wav`);
    } finally {
      setBusy(false);
    }
  };

  const fmt = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-t border-neutral-800">
      <button
        onClick={handleToggle}
        disabled={busy}
        className={`
          flex items-center gap-1.5 px-3 py-1 text-xs font-bold border tracking-widest transition-colors
          ${isRecording
            ? 'border-red-500 text-red-400 bg-red-900/20 hover:bg-red-900/40 animate-pulse'
            : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
          }
          disabled:opacity-40 disabled:pointer-events-none
        `}
      >
        <span className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500' : 'bg-neutral-600'}`} />
        {isRecording ? `REC ${fmt(elapsed)}` : 'REC'}
      </button>

      {error && (
        <span className="text-xs text-red-400 font-mono">{error}</span>
      )}

      {lastBlob && !isRecording && (
        <>
          <button
            onClick={downloadWebM}
            disabled={busy}
            className="px-2 py-1 text-xs border border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200 transition-colors disabled:opacity-40"
          >
            ↓ WebM
          </button>
          <button
            onClick={downloadWAV}
            disabled={busy}
            className="px-2 py-1 text-xs border border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200 transition-colors disabled:opacity-40"
          >
            ↓ WAV
          </button>
        </>
      )}
    </div>
  );
}
