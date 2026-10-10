import { useEffect, useState } from 'react';
import { useAppStore, useAccent } from '../store/appStore';
import { useProjectStatus } from '../store/projectState';
import { getSettings, updateSettings, useSettings } from '../store/settings';
import { enableAudio, getAudioHealth, subscribeAudioHealth, useAudioHealth } from '../engine/audioHealth';
import { useFocusZone } from './focus';
import { notify } from './notices';

// ─── Automatic Eco mode ───────────────────────────────────────────────────────

/** Dropouts within this window switch Eco mode on (when allowed). */
const ECO_WINDOW_MS = 20000;
const ECO_DROPOUTS = 2;
/** Once the user turns automatic Eco off again, don't switch it back on this session. */
let ecoDeclined = false;

/**
 * When the audio thread can't keep up, turn Eco mode on and say so, with a
 * one-click way back. Installed once by the status bar.
 */
function installAutoEco(): () => void {
  let seen = getAudioHealth().dropouts;
  const times: number[] = [];
  return subscribeAudioHealth(() => {
    const { dropouts } = getAudioHealth();
    if (dropouts <= seen) { seen = dropouts; return; }
    const now = performance.now();
    for (let i = seen; i < dropouts; i++) times.push(now);
    seen = dropouts;
    while (times.length && now - times[0] > ECO_WINDOW_MS) times.shift();
    const s = getSettings();
    if (times.length < ECO_DROPOUTS || s.ecoMode || !s.autoEco || ecoDeclined) return;
    updateSettings({ ecoMode: true });
    notify(
      'Audio dropouts detected, so Eco mode is now on: lighter voices, shorter tails and slower meters. '
        + 'You can switch it off in the status bar or in Settings.',
      'warn',
      { label: 'Turn off', run: () => { ecoDeclined = true; updateSettings({ ecoMode: false }); } },
    );
  });
}

// ─── Hover hint ───────────────────────────────────────────────────────────────

/** The tooltip of whatever is under the mouse, for the status bar. */
function useHoverHint(): string {
  const [hint, setHint] = useState('');
  useEffect(() => {
    const over = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-hint],[title]') as HTMLElement | null;
      setHint(el ? (el.dataset.hint ?? el.title ?? '') : '');
    };
    document.addEventListener('mouseover', over);
    return () => document.removeEventListener('mouseover', over);
  }, []);
  return hint;
}

// ─── Bar ──────────────────────────────────────────────────────────────────────

const ZONE_NAMES = { arrange: 'Arrangement', editor: 'Editor', other: 'Arrangement' } as const;

/**
 * One line at the bottom: is the song saved, is audio running and how hard
 * is it working, which area the keys act on, and what the control under the
 * mouse does.
 */
export function StatusBar() {
  const { state } = useAppStore();
  const accent = useAccent();
  const status = useProjectStatus();
  const audio = useAudioHealth();
  const settings = useSettings();
  const zone = useFocusZone();
  const hint = useHoverHint();

  useEffect(() => installAutoEco(), []);

  const sep = <span className="w-px self-stretch bg-neutral-800 mx-2" aria-hidden />;
  const load = audio.load === null ? null : Math.round(audio.load * 100);
  const loadColor = load === null ? 'var(--color-neutral-500)'
    : load >= 85 ? 'var(--color-red-400)' : load >= 65 ? 'var(--color-amber-400)' : accent;

  return (
    <footer
      aria-label="Status bar"
      className="h-6 shrink-0 flex items-center px-3 text-[11px] text-neutral-400 border-t border-neutral-800 bg-[var(--surface-1)] whitespace-nowrap overflow-hidden"
    >
      {/* Save state */}
      <span className="flex items-center gap-1.5 min-w-0" data-testid="save-state"
        title={status.fileName ? `Saves to ${status.fileName}` : 'Not saved to a file yet'}>
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: status.saving ? 'var(--color-neutral-400)' : status.dirty ? 'var(--color-amber-400)' : accent }}
          aria-hidden
        />
        <span className={status.dirty ? 'text-amber-300' : ''}>
          {status.saving ? 'Saving…' : status.dirty ? 'Unsaved changes' : 'Saved'}
        </span>
        <span className="text-neutral-500 truncate max-w-[220px]">· {status.fileName ?? state.projectName}</span>
      </span>
      {sep}

      {/* Audio */}
      <span className="flex items-center gap-1.5" data-testid="audio-state">
        {audio.state === 'running' ? (
          <span title="Sample rate and output latency">
            Audio {(audio.sampleRate / 1000).toFixed(1)} kHz{audio.latencyMs !== null ? ` · ${audio.latencyMs} ms` : ''}
          </span>
        ) : (
          <>
            <span className={audio.state === 'suspended' ? 'text-amber-300' : ''}>
              {audio.state === 'none' ? 'Audio off' : audio.state === 'suspended' ? 'Audio paused by the browser' : 'Audio closed'}
            </span>
            <button
              onClick={() => void enableAudio()}
              className="px-1.5 border leading-4"
              style={{ borderColor: accent, color: accent }}
              title="Start the audio engine (browsers wait for a click before playing sound)"
            >Enable audio</button>
          </>
        )}
      </span>
      {sep}

      {/* Load */}
      <span className="flex items-center gap-1.5" data-testid="audio-load"
        title="How hard the audio thread is working. Above about 85 % sound can break up — Eco mode helps.">
        Load
        <span className="flex gap-px" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="w-1.5 h-2.5"
              style={{ backgroundColor: load !== null && load > i * 20 ? loadColor : 'var(--color-neutral-800)' }} />
          ))}
        </span>
        <span className="font-mono w-8 text-right">{load === null ? '—' : `${load}%`}</span>
        <span className={audio.dropouts ? 'text-amber-300' : 'text-neutral-500'}
          title={audio.dropouts ? 'The audio thread fell behind. Try Eco mode, fewer tracks, or closing the visualizer.' : 'No dropouts'}>
          {audio.dropouts} dropout{audio.dropouts === 1 ? '' : 's'}
        </span>
      </span>
      <button
        onClick={() => { ecoDeclined = settings.ecoMode; updateSettings({ ecoMode: !settings.ecoMode }); }}
        className="ml-2 px-1.5 border leading-4 tracking-widest"
        style={settings.ecoMode
          ? { borderColor: accent, color: accent }
          : { borderColor: 'var(--color-neutral-700)', color: 'var(--color-neutral-500)' }}
        aria-pressed={settings.ecoMode}
        title="Eco mode: lighter sound engine for slow machines — narrower stereo, shorter tails, slower meters"
      >ECO</button>
      {sep}

      {/* Keys */}
      <span title="Keys like Delete, M, S, L and K act on the area you clicked last">
        Keys: <span className="text-neutral-300">{ZONE_NAMES[zone]}</span>
      </span>
      {sep}

      {/* Hint */}
      <span className="flex-1 min-w-0 truncate text-neutral-500" aria-hidden>{hint}</span>
    </footer>
  );
}
