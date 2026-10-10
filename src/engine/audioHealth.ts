/**
 * Is audio running, how loaded is the audio thread, and has it dropped out?
 * Read by the status bar; drives automatic Eco mode.
 */
import { useSyncExternalStore } from 'react';
import { getAudioEngine, onAudioContext } from './audio';
// Emitted as a real file, like the recorder's worklet, so a strict CSP allows it
import probeUrl from './load-probe.worklet.js?url&no-inline';

export interface AudioHealth {
  /** 'none' until something first needs sound. */
  state: AudioContextState | 'none';
  sampleRate: number;
  /** Output latency in ms (base + device), when the browser reports it. */
  latencyMs: number | null;
  /** Audio-thread load 0–1 (smoothed), null when it can't be measured. */
  load: number | null;
  /** Dropouts heard (or overloads that would cause them) since audio started. */
  dropouts: number;
}

/** A measuring window this busy can't have been rendered in time. */
const OVERLOAD = 0.98;

let health: AudioHealth = { state: 'none', sampleRate: 0, latencyMs: null, load: null, dropouts: 0 };
const listeners = new Set<() => void>();

function publish(patch: Partial<AudioHealth>): void {
  const next = { ...health, ...patch };
  if ((Object.keys(patch) as (keyof AudioHealth)[]).every((k) => next[k] === health[k])) return;
  health = next;
  for (const l of listeners) l();
}

export function getAudioHealth(): AudioHealth {
  return health;
}

export function subscribeAudioHealth(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useAudioHealth(): AudioHealth {
  return useSyncExternalStore(subscribeAudioHealth, () => health, () => health);
}

/** Chrome's glitch counter, behind a flag today. */
type PlayoutContext = AudioContext & { playoutStats?: { fallbackFramesEvents?: number } };

async function watch(ctx: AudioContext): Promise<void> {
  const playout = ctx as PlayoutContext;
  const glitchBase = playout.playoutStats?.fallbackFramesEvents;
  let overloads = 0;

  const poll = () => {
    if (getAudioEngine().getAudioContext() !== ctx) return;
    const latency = (ctx.baseLatency ?? 0) + ((ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0);
    const glitches = glitchBase === undefined ? undefined : (playout.playoutStats?.fallbackFramesEvents ?? glitchBase) - glitchBase;
    publish({
      state: ctx.state,
      sampleRate: ctx.sampleRate,
      latencyMs: latency > 0 ? Math.round(latency * 1000) : null,
      dropouts: glitches ?? overloads,
    });
  };
  poll();
  ctx.addEventListener('statechange', poll);
  setInterval(poll, 1000);

  try {
    await ctx.audioWorklet.addModule(probeUrl);
    const probe = new AudioWorkletNode(ctx, 'osc-load-probe', { numberOfInputs: 0, numberOfOutputs: 1 });
    let smooth: number | null = null;
    probe.port.onmessage = (e: MessageEvent<{ load: number | null }>) => {
      const { load } = e.data;
      if (load === null) { publish({ load: null }); return; }
      smooth = smooth === null ? load : smooth * 0.6 + load * 0.4;
      if (load >= OVERLOAD && glitchBase === undefined) {
        overloads++;
        publish({ dropouts: overloads });
      }
      publish({ load: Math.round(smooth * 100) / 100 });
    };
    // Silent output; being connected keeps it in every render quantum
    probe.connect(ctx.destination);
  } catch (err) {
    console.warn('Audio load probe unavailable.', err);
  }
}

onAudioContext((ctx) => { void watch(ctx); });

/** Start audio after the browser blocked it (autoplay policy). */
export async function enableAudio(): Promise<void> {
  await getAudioEngine().getOrCreateAudioContext();
}
