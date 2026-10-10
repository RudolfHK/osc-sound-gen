import { useEffect, useRef, useState } from 'react';
import { findClip, useAccent } from '../store/appStore';
import type { SequencerState } from '../utils/music';
import type { DockTab } from './Dock';
import { toLayout } from './scale';

/** What the tour watches to know a step is done. */
export interface TourContext {
  seq: SequencerState;
  dockTab: DockTab;
  dockCollapsed: boolean;
  exportOpen: boolean;
}

interface Step {
  title: string;
  text: string;
  /** The control to point at (CSS selector). */
  target: string;
  /** Done yet? `start` is the state when the step began. */
  done: (now: TourContext, start: TourContext) => boolean;
}

const noteCount = (seq: SequencerState) => Object.values(seq.patterns).reduce((n, p) => n + p.notes.length, 0);
const sources = (seq: SequencerState) => JSON.stringify(seq.tracks.map((t) => t.source));
const faders = (seq: SequencerState) => seq.tracks.map((t) => t.channel.gain).join();

const STEPS: Step[] = [
  {
    title: 'Play the song',
    text: 'Press ▶ PLAY (or Space) to hear Midnight Drive. Press it again to stop whenever you like.',
    target: '[data-tour="play"]',
    done: (n) => n.seq.isPlaying,
  },
  {
    title: 'Open a clip',
    text: 'Double-click a clip on the Lead, Arp or Pad track. It opens in the piano roll below.',
    target: '[data-arrange-lanes]',
    done: (n) => {
      const hit = findClip(n.seq, n.seq.selectedClipId);
      return n.dockTab === 'editor' && !n.dockCollapsed && !!hit && hit.track.source.type !== 'drums';
    },
  },
  {
    title: 'Draw a note',
    text: 'Click an empty spot in the piano roll to add a note. Drag it to move it, right-click to delete it.',
    target: 'canvas[aria-label^="Piano roll"]',
    done: (n, s) => noteCount(n.seq) > noteCount(s.seq),
  },
  {
    title: 'Change the sound',
    text: 'Open the INSTRUMENTS tab and click another sound — the selected track plays it straight away.',
    target: '[data-tour="tab-instruments"]',
    done: (n, s) => sources(n.seq) !== sources(s.seq),
  },
  {
    title: 'Mix',
    text: 'Open the MIXER tab and drag a track’s fader up or down.',
    target: '[data-tour="tab-mixer"]',
    done: (n, s) => faders(n.seq) !== faders(s.seq),
  },
  {
    title: 'Export',
    text: 'Click EXPORT to render the song as WAV or MP3, or each track as its own file.',
    target: '[data-tour="export"]',
    done: (n) => n.exportOpen,
  },
];

const TOUR_DONE = 'osc-tour-done';

/**
 * A six-step walk through the app. It doesn't block anything: each step points
 * at a control and moves on once the user has done what it says.
 */
export function Tour({ ctx, onEnd }: { ctx: TourContext; onEnd: () => void }) {
  const accent = useAccent();
  const [index, setIndex] = useState(0);
  const [ticked, setTicked] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const start = useRef(ctx);
  const step = STEPS[index];
  const finished = index >= STEPS.length;

  // A new step measures from where things are now
  useEffect(() => { start.current = ctx; setTicked(false); }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!finished && !ticked && step.done(ctx, start.current)) setTicked(true);
  }, [ctx, step, finished, ticked]);

  // A short "✓ done", then the next step
  useEffect(() => {
    if (!ticked) return;
    const id = setTimeout(() => setIndex((i) => i + 1), 700);
    return () => clearTimeout(id);
  }, [ticked]);

  // Follow the target as the layout changes
  useEffect(() => {
    if (finished) { setRect(null); return; }
    const measure = () => {
      const el = document.querySelector(step.target);
      const r = el?.getBoundingClientRect();
      setRect(r && r.width > 0 ? r : null);
    };
    measure();
    const id = setInterval(measure, 250);
    return () => clearInterval(id);
  }, [step, finished]);

  const end = () => {
    try { localStorage.setItem(TOUR_DONE, '1'); } catch { /* ignore */ }
    onEnd();
  };

  return (
    <>
      {rect && (
        <div
          aria-hidden
          className="fixed z-[90] pointer-events-none rounded-sm motion-safe:animate-pulse"
          style={{
            left: toLayout(rect.left) - 4, top: toLayout(rect.top) - 4,
            width: toLayout(rect.width) + 8, height: toLayout(rect.height) + 8,
            boxShadow: `0 0 0 2px ${accent}, 0 0 0 6px ${accent}33`,
          }}
        />
      )}
      <div
        role="dialog"
        aria-label="Tour"
        className="fixed z-[95] left-3 bottom-9 w-[320px] bg-neutral-900 border shadow-2xl p-3 text-xs"
        style={{ borderColor: accent }}
      >
        {finished ? (
          <>
            <div className="text-[11px] tracking-widest mb-1" style={{ color: accent }}>TOUR COMPLETE</div>
            <p className="text-neutral-300 leading-relaxed">
              That’s the whole loop: play, edit, change sounds, mix, export. Press <b>?</b> for every
              shortcut, or <b>F1</b> for the guide at whatever panel you’re in.
            </p>
            <div className="flex justify-end mt-2">
              <button onClick={end} className="px-2 py-1 border" style={{ borderColor: accent, color: accent }}>FINISH</button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] tracking-widest" style={{ color: accent }}>
                STEP {index + 1} OF {STEPS.length}
              </span>
              <span className="ml-auto text-[11px] text-neutral-500">{ticked ? '✓ done' : ''}</span>
            </div>
            <div className="text-sm text-neutral-100 mb-1">{step.title}</div>
            <p className="text-neutral-400 leading-relaxed">{step.text}</p>
            <div className="flex justify-between mt-2">
              <button onClick={end} className="text-neutral-500 hover:text-neutral-200 underline">Skip tour</button>
              <button onClick={() => setIndex((i) => i + 1)} className="text-neutral-500 hover:text-neutral-200">Next →</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
