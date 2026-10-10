import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore, useAccent } from '../store/appStore';
import { useEffectsStore, effectsSettingsOf } from '../store/effectsStore';
import { getSequencerEngine } from '../engine/sequencer';
import { getEffectsBus } from '../engine/effects';
import { setPlayhead } from '../engine/playhead';
import { parseProject } from '../utils/project';
import { makeDefaultSequencerState } from '../utils/music';
import { updateSettings, useSettings } from '../store/settings';
import { Dialog } from './kit/Dialog';
import { EXAMPLES, TEMPLATES, formatLength, loadExampleText } from './examples';
import { notify } from './notices';

const WELCOME_SEEN = 'osc-welcome-seen';
/** How long a preview plays before stopping by itself. */
const PREVIEW_S = 20;

/** Show the welcome screen at startup? Always the first time; afterwards if Settings say so. */
export function welcomeDueAtStart(welcomeOnStart: boolean): boolean {
  try {
    if (!localStorage.getItem(WELCOME_SEEN)) {
      localStorage.setItem(WELCOME_SEEN, '1');
      return true;
    }
  } catch { /* storage unavailable: don't nag */ }
  return welcomeOnStart;
}

/**
 * Plays the start of an example through the live engine without loading it:
 * the session's tracks, mix and effects are put back when it stops.
 */
function useExamplePreview() {
  const { state, dispatch } = useAppStore();
  const { state: fx } = useEffectsStore();
  const [playing, setPlaying] = useState<string | null>(null);
  const session = useRef({ seq: state.sequencer, fx });
  session.current = { seq: state.sequencer, fx };
  const active = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const stop = useCallback(() => {
    clearTimeout(timer.current);
    if (!active.current) return;
    active.current = null;
    const engine = getSequencerEngine();
    engine.stop();
    const { seq, fx: sessionFx } = session.current;
    engine.applyMixState(seq);
    getEffectsBus().update(effectsSettingsOf(sessionFx), seq.bpm);
    setPlayhead(seq.playheadBeat);
    setPlaying(null);
  }, []);

  const toggle = useCallback(async (file: string) => {
    if (active.current === file) { stop(); return; }
    stop();
    // The session's own playback stops first
    if (session.current.seq.isPlaying) {
      getSequencerEngine().stop();
      dispatch({ type: 'SEQ_SET_PLAYING', playing: false });
    }
    active.current = file;
    setPlaying(file);
    try {
      const p = parseProject(JSON.parse(await loadExampleText(file)));
      if (active.current !== file) return;
      // Skip a quiet intro: start at the second section when it comes early
      const markers = [...p.doc.markers].sort((a, b) => a.beat - b.beat);
      const second = markers[1];
      const start = second && second.beat <= p.songLengthBars * p.beatsPerBar * 0.4 ? second.beat : 0;
      getEffectsBus().update(p.effects, p.bpm);
      await getSequencerEngine().play(start, {
        seq: {
          ...makeDefaultSequencerState(), ...p.doc,
          bpm: p.bpm, beatsPerBar: p.beatsPerBar, songLengthBars: p.songLengthBars, loopEnabled: false,
        },
        tabs: p.oscillators,
        drumPatterns: p.drumPatterns,
      });
      timer.current = setTimeout(stop, PREVIEW_S * 1000);
    } catch (err) {
      console.error(err);
      notify("Couldn't preview that example.", 'error');
      stop();
    }
  }, [dispatch, stop]);

  useEffect(() => stop, [stop]);
  return { playing, toggle, stop };
}

interface Props {
  /** "welcome" at startup or from Help; "new" from File → New project. */
  mode: 'welcome' | 'new';
  onClose: () => void;
  onNew: (kind: string) => void;
  onOpen: () => void;
  onExample: (file: string) => void;
  onTour: () => void;
}

/** Start screen: new project (starter, empty, template), open, examples with previews, the tour. */
export function Welcome({ mode, onClose, onNew, onOpen, onExample, onTour }: Props) {
  const accent = useAccent();
  const settings = useSettings();
  const preview = useExamplePreview();

  // Every choice closes this screen first; any unsaved-changes question comes next
  const choose = (fn: () => void) => () => { preview.stop(); onClose(); fn(); };

  const card = 'text-left p-2.5 border border-neutral-700 bg-[var(--surface-1)] hover:border-neutral-400 transition-colors';

  return (
    <Dialog title={mode === 'new' ? 'New project' : 'Welcome to OSC'} onClose={onClose} className="w-[900px]">
      <div className="grid md:grid-cols-[1fr_1.15fr] gap-6 px-4 py-3">
        <section aria-label="Start something" className="space-y-4">
          <div>
            <h3 className="text-[11px] tracking-widest text-neutral-500 mb-2">START SOMETHING</h3>
            <div className="grid grid-cols-3 gap-2">
              <button className={card} onClick={choose(() => onNew('starter'))} data-autofocus="">
                <span className="block text-sm text-neutral-100">Starter</span>
                <span className="block text-[11px] text-neutral-500 leading-snug mt-0.5">Drums, bass, keys and pad, ready for notes</span>
              </button>
              <button className={card} onClick={choose(() => onNew('empty'))}>
                <span className="block text-sm text-neutral-100">Empty</span>
                <span className="block text-[11px] text-neutral-500 leading-snug mt-0.5">No tracks — add your own</span>
              </button>
              <button className={card} onClick={choose(onOpen)}>
                <span className="block text-sm text-neutral-100">Open…</span>
                <span className="block text-[11px] text-neutral-500 leading-snug mt-0.5">A project file from your computer</span>
              </button>
            </div>
          </div>
          <div>
            <h3 className="text-[11px] tracking-widest text-neutral-500 mb-2">TEMPLATES</h3>
            <p className="text-[11px] text-neutral-500 mb-2 leading-snug">
              A genre’s tracks, sounds, mix and beat — no notes yet. The beat loops so you can write over it.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {TEMPLATES.map((t) => (
                <button key={t.id} className={card} onClick={choose(() => onNew(t.id))}>
                  <span className="block text-sm text-neutral-100">{t.title}</span>
                  <span className="block text-[11px] text-neutral-500 leading-snug mt-0.5">{t.description}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section aria-label="Examples" className="min-w-0">
          <h3 className="text-[11px] tracking-widest text-neutral-500 mb-2">OR OPEN AN EXAMPLE</h3>
          <ul className="max-h-[calc(54vh/var(--ui-zoom,1))] overflow-y-auto border border-neutral-800 divide-y divide-neutral-800">
            {EXAMPLES.map((ex) => {
              const on = preview.playing === ex.file;
              return (
                <li key={ex.file} className="flex items-stretch">
                  <button
                    onClick={() => void preview.toggle(ex.file)}
                    className="w-9 shrink-0 flex items-center justify-center text-xs border-r border-neutral-800 hover:bg-neutral-800"
                    style={on ? { color: accent } : { color: 'var(--color-neutral-400)' }}
                    aria-label={on ? `Stop preview of ${ex.title}` : `Preview ${ex.title}`}
                    aria-pressed={on}
                    title={on ? 'Stop the preview' : 'Hear the first bars without opening it'}
                  >{on ? '■' : '▶'}</button>
                  <button
                    onClick={choose(() => onExample(ex.file))}
                    className="flex-1 min-w-0 text-left px-2.5 py-1.5 hover:bg-neutral-800"
                    aria-label={`Open ${ex.title}`}
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="text-sm text-neutral-100 truncate">{ex.title}</span>
                      <span className="text-[11px] text-neutral-500 whitespace-nowrap">
                        {ex.genre}{ex.seconds ? ` · ${formatLength(ex.seconds)}` : ''}
                      </span>
                      {ex.featured && <span className="text-[11px] px-1 border" style={{ borderColor: accent, color: accent }}>START HERE</span>}
                    </span>
                    {ex.description && <span className="block text-[11px] text-neutral-500 leading-snug">{ex.description}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 pt-1 border-t border-neutral-800">
        <button onClick={choose(onTour)} className="text-xs underline" style={{ color: accent }}>
          New here? Take the 2-minute tour →
        </button>
        <label className="flex items-center gap-1.5 text-xs text-neutral-400">
          <input
            type="checkbox"
            checked={settings.welcomeOnStart}
            onChange={(e) => updateSettings({ welcomeOnStart: e.target.checked })}
            style={{ accentColor: accent }}
          />
          Show this when the app starts
        </label>
      </div>
    </Dialog>
  );
}
