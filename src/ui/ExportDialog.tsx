import { useMemo, useRef, useState } from 'react';
import { useAppStore, useAccent } from '../store/appStore';
import { useDrumStore } from '../store/drumStore';
import { useEffectsStore } from '../store/effectsStore';
import { getSequencerEngine } from '../engine/sequencer';
import {
  exportArrangement, exportTake, DEFAULT_EXPORT, RenderCancelled,
  type ExportResult, type ExportSettings, type Progress,
} from '../export/exporter';
import { tracksWithContent } from '../export/render';
import { MP3_BITRATES, MP3_SAMPLE_RATES, mp3Size } from '../export/mp3';
import { wavSize } from '../export/wav';
import { contentEndBeat, sectionsFromMarkers } from '../utils/music';
import { downloadBlob } from '../utils/wav';
import { closeExport, useExportState } from './exportState';
import { notify } from './notices';
import { Dialog } from './kit/Dialog';

const LS_KEY = 'osc-export-settings';

function loadSettings(): ExportSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...DEFAULT_EXPORT, ...(JSON.parse(raw) as Partial<ExportSettings>) };
  } catch { /* unavailable or corrupt */ }
  return DEFAULT_EXPORT;
}

function saveSettings(s: ExportSettings) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

const fmtBytes = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtDb = (d: number) => (Number.isFinite(d) ? `${d > 0 ? '+' : ''}${d.toFixed(1)}` : '−∞');

const PHASE_LABEL: Record<Progress['phase'], string> = {
  render: 'Rendering', encode: 'Encoding', zip: 'Packing stems',
};

export function ExportDialog() {
  const { open, take } = useExportState();
  if (!open) return null;
  return <ExportDialogBody source={open === 'take' && take ? 'take' : 'song'} />;
}

function ExportDialogBody({ source }: { source: 'song' | 'take' }) {
  const { state, dispatch } = useAppStore();
  const { state: drumState, dispatch: drumDispatch } = useDrumStore();
  const { state: effects } = useEffectsStore();
  const { take } = useExportState();
  const accent = useAccent();
  const seq = state.sequencer;

  const [s, setS] = useState<ExportSettings>(loadSettings);
  const set = (patch: Partial<ExportSettings>) => setS((prev) => { const n = { ...prev, ...patch }; saveSettings(n); return n; });

  // ── Ranges ──
  const songEnd = Math.max(seq.songLengthBars * seq.beatsPerBar, contentEndBeat(seq.tracks));
  const ranges = useMemo(() => {
    const out = [{ id: 'song', label: 'Whole song', startBeat: 0, endBeat: songEnd, file: '' }];
    if (seq.loopEndBeat > seq.loopStartBeat) {
      out.push({ id: 'loop', label: `Loop (bars ${seq.loopStartBeat / seq.beatsPerBar + 1}–${seq.loopEndBeat / seq.beatsPerBar + 1})`, startBeat: seq.loopStartBeat, endBeat: seq.loopEndBeat, file: 'loop' });
    }
    for (const sec of sectionsFromMarkers(seq.markers, songEnd)) {
      if (sec.endBeat > sec.beat) out.push({ id: sec.id, label: `Section: ${sec.name}`, startBeat: sec.beat, endBeat: sec.endBeat, file: sec.name });
    }
    return out;
  }, [seq.loopStartBeat, seq.loopEndBeat, seq.markers, seq.beatsPerBar, songEnd]);
  const [rangeId, setRangeId] = useState('song');
  const range = ranges.find((r) => r.id === rangeId) ?? ranges[0];

  // ── Run state ──
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busy = progress !== null && !result && !error;

  const isTake = source === 'take' && !!take;
  const format = isTake && s.format === 'midi' ? 'wav' : s.format;
  const stems = !isTake && s.stems && format !== 'midi';
  const mp3RateOk = MP3_SAMPLE_RATES.includes(isTake ? take!.sampleRate : s.sampleRate);

  // ── Size estimate ──
  const seconds = isTake
    ? (take!.channels[0]?.length ?? 0) / take!.sampleRate
    : (range.endBeat - range.startBeat) / (seq.bpm / 60) + 1;
  const stemCount = stems ? tracksWithContent(seq.tracks, range.startBeat, range.endBeat).length : 1;
  const estimate = format === 'midi' ? null
    : format === 'mp3' ? mp3Size(seconds, s.kbps) * stemCount
      : wavSize(Math.round(seconds * (isTake ? take!.sampleRate : s.sampleRate)), 2, s.bitDepth) * stemCount;

  const run = async () => {
    setError(null);
    setResult(null);
    setProgress({ phase: format === 'midi' ? 'encode' : 'render', fraction: 0 });
    const ac = new AbortController();
    abortRef.current = ac;
    const settings: ExportSettings = { ...s, format, stems, normalize: stems ? { mode: 'off' } : s.normalize };
    try {
      let res: ExportResult;
      if (isTake) {
        res = await exportTake(take!, settings, `${state.projectName}-recording`, setProgress, ac.signal);
      } else {
        // The renderer borrows the audio engine; live playback has to stop first
        // (and so does the drum editor's AUDITION loop)
        if (seq.isPlaying) {
          getSequencerEngine().stop();
          dispatch({ type: 'SEQ_SET_PLAYING', playing: false });
        }
        if (drumState.isPlaying) drumDispatch({ type: 'DRUM_SET_PLAYING', playing: false });
        res = await exportArrangement(
          { seq, tabs: state.tabs, drumPatterns: drumState.patterns, effects, masterVolume: state.masterVolume },
          settings, { startBeat: range.startBeat, endBeat: range.endBeat, label: range.file },
          state.projectName, setProgress, ac.signal,
        );
      }
      setResult(res);
      downloadBlob(res.blob, res.filename);
      notify(`Exported ${res.filename}`);
    } catch (err) {
      if (err instanceof RenderCancelled || (err as Error).name === 'AbortError') {
        setProgress(null);
        return;
      }
      console.error(err);
      setError((err as Error).message || 'Export failed.');
    } finally {
      abortRef.current = null;
    }
  };

  // ── UI helpers ──
  const seg = <T extends string | number>(value: T, options: { v: T; label: string; disabled?: boolean }[], onPick: (v: T) => void) => (
    <div className="flex flex-wrap gap-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.v)}
          role="radio"
          aria-checked={value === o.v}
          disabled={o.disabled || busy}
          onClick={() => onPick(o.v)}
          className="px-2 py-1 text-xs border transition-colors disabled:opacity-30"
          style={value === o.v
            ? { borderColor: accent, color: accent, backgroundColor: accent + '1c' }
            : { borderColor: 'var(--color-neutral-700)', color: 'var(--color-neutral-400)' }}
        >{o.label}</button>
      ))}
    </div>
  );
  const row = (label: string, child: React.ReactNode, hint?: string) => (
    <div role="group" aria-label={label[0] + label.slice(1).toLowerCase()} className="grid grid-cols-[110px_1fr] gap-3 items-start">
      <span className="text-xs text-neutral-500 tracking-widest pt-1">{label}</span>
      <div className="flex flex-col gap-1">{child}{hint && <span className="text-[11px] text-neutral-500 leading-snug">{hint}</span>}</div>
    </div>
  );

  const n = s.normalize;

  return (
    // Dialog traps focus, returns it on close, pauses the app's shortcuts and
    // closes on Escape — except while an export is running
    <Dialog title="Export" bare locked={busy} onClose={closeExport} className="w-[560px]">
        <div className="flex items-center px-4 py-2.5 border-b border-neutral-800">
          <span className="text-sm tracking-widest" style={{ color: accent }}>
            {isTake ? 'EXPORT RECORDING' : 'EXPORT'}
          </span>
          <span className="ml-2 text-xs text-neutral-500 truncate">
            {isTake ? `${fmtTime(seconds)} live take` : state.projectName}
          </span>
          <button onClick={closeExport} disabled={busy} className="ml-auto text-neutral-500 hover:text-neutral-200 disabled:opacity-30" aria-label="Close">✕</button>
        </div>

        <div className="flex flex-col gap-3.5 px-4 py-4">
          {row('FORMAT', seg(format, [
            { v: 'wav', label: 'WAV' },
            { v: 'mp3', label: 'MP3' },
            { v: 'midi', label: 'MIDI', disabled: isTake },
          ], (v) => set({ format: v })),
          format === 'wav' ? 'Uncompressed — for mastering, other DAWs, archiving.'
            : format === 'mp3' ? 'Compressed — for sharing and listening. 320 kbps is transparent for most listeners.'
              : 'The notes, not the audio — opens in Ableton, Logic, FL Studio, MuseScore and other MIDI software.')}

          {!isTake && format !== 'midi' && row('WHAT', seg(stems ? 'stems' : 'mix', [
            { v: 'mix', label: 'Mixdown' },
            { v: 'stems', label: 'Stems (ZIP)' },
          ], (v) => set({ stems: v === 'stems' })),
          stems ? `One file per track that plays in this range (${stemCount}), all the same length, each with its own effects — ready to line up in another DAW.` : undefined)}

          {!isTake && row('RANGE', (
            <select
              value={rangeId}
              onChange={(e) => setRangeId(e.target.value)}
              disabled={busy}
              className="bg-neutral-950 border border-neutral-700 text-xs text-neutral-200 px-1.5 py-1 w-full"
              aria-label="Range"
            >
              {ranges.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          ), `${fmtTime((range.endBeat - range.startBeat) / (seq.bpm / 60))} at ${seq.bpm} BPM${format !== 'midi' ? ' — reverb and release tails are included, then silence is trimmed' : ''}`)}

          {format === 'wav' && (
            <>
              {!isTake && row('SAMPLE RATE', seg(s.sampleRate, [
                { v: 44100, label: '44.1 kHz' }, { v: 48000, label: '48 kHz' }, { v: 96000, label: '96 kHz' },
              ], (v) => set({ sampleRate: v })), '44.1 kHz for CD and most streaming, 48 kHz for video.')}
              {row('BIT DEPTH', seg(s.bitDepth, [
                { v: 16, label: '16-bit' }, { v: 24, label: '24-bit' }, { v: 32, label: '32-bit float' },
              ], (v) => set({ bitDepth: v })), s.bitDepth === 16 ? undefined : s.bitDepth === 24 ? 'The usual choice for sending to mastering.' : 'Can’t clip — useful if more processing follows.')}
              {s.bitDepth === 16 && row('DITHER', seg(s.dither ? 'on' : 'off', [
                { v: 'on', label: 'On' }, { v: 'off', label: 'Off' },
              ], (v) => set({ dither: v === 'on' })), 'Adds inaudible noise so quiet fades don’t turn grainy at 16-bit. Leave on for final masters.')}
            </>
          )}

          {format === 'mp3' && (
            <>
              {row('BITRATE', seg(s.kbps, MP3_BITRATES.map((k) => ({ v: k, label: `${k}` })), (v) => set({ kbps: v })), 'kbps, constant bitrate.')}
              {row('CHANNELS', seg(s.mono ? 'mono' : 'stereo', [
                { v: 'stereo', label: 'Stereo' }, { v: 'mono', label: 'Mono' },
              ], (v) => set({ mono: v === 'mono' })))}
              {!isTake && row('SAMPLE RATE', seg(s.sampleRate > 48000 ? 48000 : s.sampleRate, [
                { v: 44100, label: '44.1 kHz' }, { v: 48000, label: '48 kHz' },
              ], (v) => set({ sampleRate: v })))}
              {isTake && !mp3RateOk && <span className="text-xs text-amber-400">This recording’s sample rate can’t be stored as MP3 — use WAV.</span>}
            </>
          )}

          {format === 'midi' && row('ARPEGGIATOR', seg(s.bakeArpeggiator ? 'bake' : 'chords', [
            { v: 'bake', label: 'Write the arpeggio' }, { v: 'chords', label: 'Write held chords' },
          ], (v) => set({ bakeArpeggiator: v === 'bake' })), 'Drum tracks go to MIDI channel 10 with General MIDI drum notes; section names become markers.')}

          {format !== 'midi' && !stems && row('NORMALIZE', (
            <>
              {seg(n.mode, [
                { v: 'off', label: 'Off' },
                { v: 'peak', label: 'Peak' },
                { v: 'loudness', label: 'Loudness' },
              ], (v) => set({
                normalize: v === 'off' ? { mode: 'off' }
                  : v === 'peak' ? { mode: 'peak', ceilingDb: -1 }
                    : { mode: 'loudness', targetLufs: -14, ceilingDb: -1 },
              }))}
              {n.mode === 'loudness' && (
                <div className="flex items-center gap-2 text-xs text-neutral-400">
                  Target
                  <select
                    value={n.targetLufs}
                    onChange={(e) => set({ normalize: { ...n, targetLufs: parseFloat(e.target.value) } })}
                    className="bg-neutral-950 border border-neutral-700 text-neutral-200 px-1 py-0.5"
                    aria-label="Loudness target"
                  >
                    <option value={-14}>−14 LUFS · Spotify, YouTube, Tidal</option>
                    <option value={-16}>−16 LUFS · Apple Music, podcasts</option>
                    <option value={-11}>−11 LUFS · loud club master</option>
                    <option value={-23}>−23 LUFS · EBU R128 broadcast</option>
                  </select>
                </div>
              )}
            </>
          ), n.mode === 'peak' ? 'Raises or lowers the whole mix so its loudest sample sits at −1 dBFS.'
            : n.mode === 'loudness' ? 'Matches how streaming services measure loudness (ITU-R BS.1770). Never pushes peaks above −1 dBFS.'
              : 'Exports at the level you hear in the app.')}
        </div>

        {/* Progress / result */}
        <div className="px-4 pb-4 flex flex-col gap-2">
          {progress && !result && !error && (
            <div className="flex flex-col gap-1" aria-live="polite">
              <div className="flex justify-between text-xs text-neutral-400">
                <span>{PHASE_LABEL[progress.phase]}{progress.detail ? ` · ${progress.detail}` : ''}…</span>
                <span className="font-mono">{Math.round(progress.fraction * 100)}%</span>
              </div>
              <div className="h-1.5 bg-neutral-800 rounded-sm overflow-hidden">
                <div className="h-full transition-[width] duration-150" style={{ width: `${progress.fraction * 100}%`, backgroundColor: accent }} />
              </div>
            </div>
          )}
          {error && <div className="text-xs text-red-300 border border-red-900 bg-red-950/40 px-2 py-1.5">{error}</div>}
          {result && (
            <div className="text-xs border border-neutral-700 bg-neutral-950 px-3 py-2 flex flex-col gap-1" data-testid="export-result">
              <div className="text-neutral-200">✓ {result.filename} <span className="text-neutral-500">· {fmtBytes(result.blob.size)}{result.seconds ? ` · ${fmtTime(result.seconds)}` : ''}{result.files ? ` · ${result.files} stems` : ''}</span></div>
              {result.levels && (
                <div className="text-neutral-400 font-mono">
                  peak {fmtDb(result.levels.peakDb)} dBFS · {fmtDb(result.levels.lufs)} LUFS
                  {result.levels.gainDb !== 0 && <> · gain {fmtDb(result.levels.gainDb)} dB</>}
                  {result.levels.ceilingLimited && <span className="text-amber-400"> · held back by the −1 dBFS ceiling</span>}
                </div>
              )}
              <button onClick={() => downloadBlob(result.blob, result.filename)} className="self-start underline text-neutral-400 hover:text-neutral-100">
                Download again
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-neutral-800">
          <span className="text-[11px] text-neutral-500">
            {estimate !== null && `≈ ${fmtBytes(estimate)}`}
            {!isTake && format !== 'midi' && ' · rendered offline, faster than real time'}
          </span>
          <div className="ml-auto flex gap-2">
            {busy ? (
              <button onClick={() => abortRef.current?.abort()} className="px-3 py-1 text-xs border border-neutral-600 text-neutral-300 hover:border-red-700 hover:text-red-300">
                Cancel
              </button>
            ) : (
              <>
                <button onClick={closeExport} className="px-3 py-1 text-xs border border-neutral-700 text-neutral-400 hover:text-neutral-100">
                  {result ? 'Done' : 'Close'}
                </button>
                <button
                  onClick={run}
                  disabled={format === 'mp3' && isTake && !mp3RateOk}
                  className="px-4 py-1 text-xs font-bold tracking-widest border disabled:opacity-30"
                  style={{ borderColor: accent, color: accent, backgroundColor: accent + '1c' }}
                >
                  {result ? 'EXPORT AGAIN' : 'EXPORT'}
                </button>
              </>
            )}
          </div>
        </div>
    </Dialog>
  );
}
