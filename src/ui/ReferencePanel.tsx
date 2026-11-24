import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAppStore, useAccent } from '../store/appStore';
import { getPlayhead, subscribePlayhead } from '../engine/playhead';
import { meter, reference, useLoudness, useReference } from '../engine/reference';
import { notify } from './notices';
import { toLayout } from './scale';
import { shortcutLabel } from './shortcuts';

const fmt = (lufs: number) => (Number.isFinite(lufs) ? lufs.toFixed(1) : '—');
const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Keep the meter and the reference with the transport: measure while the
 * song plays (afresh from each start), and play the reference at the song's
 * position, following seeks and loops.
 */
export function useReferenceSync(): void {
  const { state } = useAppStore();
  const playing = state.sequencer.isPlaying;
  const bpm = state.sequencer.bpm;
  useEffect(() => {
    if (!playing) { reference.sync(null); meter.stop(); return; }
    meter.start(true);
    const follow = (beat: number) => reference.sync((beat * 60) / bpm);
    follow(getPlayhead());
    const off = subscribePlayhead(follow);
    return () => { off(); };
  }, [playing, bpm]);
  useEffect(() => () => { reference.sync(null); meter.stop(); }, []);
}

/** Status-bar loudness of the mix; opens the reference panel. */
export function LoudnessReadout() {
  const accent = useAccent();
  const reading = useLoudness();
  const ref = useReference();
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const onRef = ref.listening === 'reference';
  return (
    <>
      <button
        data-testid="loudness-readout"
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setOpen(open ? null : { x: r.left, y: r.top }); }}
        className="flex items-center gap-1 px-1.5 border leading-4"
        style={onRef ? { borderColor: accent, color: accent } : { borderColor: 'var(--color-neutral-700)' }}
        aria-expanded={!!open}
        title="Loudness of the mix (short-term LUFS; streaming services play at about −14) · click for the reference track and A/B"
      >
        <span className="font-mono">{fmt(reading.shortTerm)}</span> LUFS
        {ref.name && <span className="tracking-widest">· {onRef ? 'REF' : 'A/B'}</span>}
      </button>
      {open && <ReferencePanel x={open.x} y={open.y} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Load a reference, switch between it and the mix, read the loudness. Non-modal. */
function ReferencePanel({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const accent = useAccent();
  const reading = useLoudness();
  const ref = useReference();
  const box = useRef<HTMLDivElement>(null);
  // Opens upwards from the status bar (anchored by its bottom edge, so it
  // grows upwards when a track is loaded), inside the window
  const [left, setLeft] = useState(toLayout(x));
  useLayoutEffect(() => {
    const w = box.current?.getBoundingClientRect().width ?? 320;
    setLeft(toLayout(Math.max(4, Math.min(x, window.innerWidth - w - 4))));
  }, [x]);
  const pos = { left, bottom: toLayout(window.innerHeight - y + 6), maxHeight: toLayout(y - 10) };
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    const away = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!box.current?.contains(t) && !t.closest?.('[data-testid="loudness-readout"]')) onClose();
    };
    document.addEventListener('keydown', key, true);
    document.addEventListener('mousedown', away);
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('mousedown', away); };
  }, [onClose]);

  const load = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aac';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await reference.load(file);
        notify(`Reference: “${file.name}”. Switch with ${shortcutLabel('transport.reference')} — it plays with the song but is never recorded or exported.`);
      } catch (err) {
        console.error(err);
        notify(`Couldn't read ${file.name} as audio.`, 'error');
      }
    };
    input.click();
  };

  const seg = (on: boolean) => `flex-1 py-1 text-xs border ${on ? '' : 'border-neutral-700 text-neutral-400 hover:text-neutral-100'}`;
  const onStyle = { borderColor: accent, color: accent, backgroundColor: accent + '18' };

  return (
    <div ref={box} role="dialog" aria-label="Reference track"
      className="fixed z-50 w-[320px] overflow-y-auto bg-neutral-900 border border-neutral-700 shadow-2xl p-3 text-xs text-neutral-400 space-y-3"
      style={pos}>
      <section aria-label="Loudness of the mix">
        <div className="text-[11px] tracking-widest text-neutral-500 mb-1">MIX LOUDNESS (LUFS)</div>
        <div className="grid grid-cols-3 gap-2 text-center">
          {([['Momentary', reading.momentary], ['Short-term', reading.shortTerm], ['Integrated', reading.integrated]] as const).map(([label, v]) => (
            <div key={label}>
              <div className="font-mono text-base text-neutral-100" aria-label={`${label} ${fmt(v)} LUFS`}>{fmt(v)}</div>
              <div className="text-neutral-500">{label}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between mt-1 text-neutral-500">
          <span>{reading.seconds ? `Integrated over ${time(reading.seconds)} of playback` : 'Play the song to measure it'}</span>
          <button className="underline hover:text-neutral-200" onClick={() => meter.reset()}>Reset</button>
        </div>
      </section>

      <section aria-label="Reference" className="space-y-2 border-t border-neutral-800 pt-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] tracking-widest text-neutral-500">REFERENCE</span>
          <span className="ml-auto" />
          {ref.name && <button className="underline hover:text-neutral-200" onClick={() => reference.clear()}>Remove</button>}
          <button className="px-1.5 py-0.5 border border-neutral-700 text-neutral-300 hover:border-neutral-500" onClick={load} disabled={ref.loading}>
            {ref.loading ? 'Reading…' : ref.name ? 'Replace…' : 'Load a track…'}
          </button>
        </div>
        {ref.name ? (
          <>
            <div className="text-neutral-200 truncate" title={ref.name}>{ref.name}</div>
            <div className="text-neutral-500">{time(ref.duration)} · {fmt(ref.lufs)} LUFS integrated</div>
            <div role="radiogroup" aria-label="Listen to" className="flex gap-1">
              <button role="radio" aria-checked={ref.listening === 'mix'} className={seg(ref.listening === 'mix')}
                style={ref.listening === 'mix' ? onStyle : undefined} onClick={() => reference.setListening('mix')}>A · Mix</button>
              <button role="radio" aria-checked={ref.listening === 'reference'} className={seg(ref.listening === 'reference')}
                style={ref.listening === 'reference' ? onStyle : undefined} onClick={() => reference.setListening('reference')}>B · Reference</button>
            </div>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={ref.match} onChange={(e) => reference.setMatch(e.target.checked)} style={{ accentColor: accent }} />
              Match loudness
              <span className="text-neutral-500 ml-auto">{ref.match ? `${ref.gainDb > 0 ? '+' : ''}${ref.gainDb.toFixed(1)} dB on the reference` : ''}</span>
            </label>
            <label className="flex items-center gap-1.5">
              <span>Reference at the song’s start</span>
              <input type="number" step={0.1} value={ref.offset} aria-label="Reference offset in seconds"
                onChange={(e) => reference.setOffset(Number(e.target.value) || 0)}
                className="w-16 ml-auto bg-neutral-950 border border-neutral-700 text-neutral-200 px-1 py-0.5 text-right" />
              <span>s</span>
            </label>
          </>
        ) : (
          <p className="text-neutral-500">
            Load a finished track to compare your mix with. It plays in time with the song, and switching is level-matched so the louder one doesn’t win by being louder.
          </p>
        )}
        <p className="text-neutral-500">Only for listening: the reference is never recorded, exported or saved with the project.</p>
      </section>
    </div>
  );
}
