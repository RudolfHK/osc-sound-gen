import { useCallback, useEffect, useRef, useState } from 'react';
import { useDrumStore } from '../store/drumStore';
import { useAppStore } from '../store/appStore';
import { getDrumSynth } from '../engine/sampler';
import { getAudioEngine } from '../engine/audio';
import type { DrumVoiceType, DrumHitParams } from '../engine/sampler';
import type { DrumVoiceConfig, DrumStep, DrumPattern } from '../store/drumStore';

// ─── Drum scheduler ───────────────────────────────────────────────────────────

class DrumScheduler {
  private running = false;
  private bpm = 120;
  private pattern: DrumPattern | null = null;
  private nextStepTime = 0;
  private nextStepIdx = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private rafId = 0;
  private onStep: ((s: number) => void) | null = null;

  async play(bpm: number, pattern: DrumPattern, onStep: (s: number) => void): Promise<void> {
    const ctx = await getAudioEngine().getOrCreateAudioContext();
    this.bpm = bpm;
    this.pattern = pattern;
    this.onStep = onStep;
    this.running = true;
    this.nextStepIdx = 0;
    this.nextStepTime = ctx.currentTime + 0.05;
    this.timer = setInterval(() => this.tick(), 25);
    this.rafLoop(ctx);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    cancelAnimationFrame(this.rafId);
  }

  updatePattern(p: DrumPattern): void { this.pattern = p; }
  updateBpm(bpm: number): void { this.bpm = bpm; }

  private stepDur(): number { return 60 / (this.bpm * 4); }

  private tick(): void {
    if (!this.running || !this.pattern) return;
    const ctx = getAudioEngine().getAudioContext();
    if (!ctx) return;
    const LOOKAHEAD = 0.12;
    const until = ctx.currentTime + LOOKAHEAD;

    while (this.nextStepTime < until) {
      const p = this.pattern;
      const stepDur = this.stepDur();
      const swingDelay = this.nextStepIdx % 2 === 1 ? p.swing * stepDur * 0.5 : 0;
      const t = this.nextStepTime + swingDelay;

      this.scheduleStep(this.nextStepIdx, t);
      this.nextStepTime += stepDur;
      this.nextStepIdx = (this.nextStepIdx + 1) % p.stepCount;
    }
  }

  private scheduleStep(idx: number, t: number): void {
    if (!this.pattern) return;
    const anySolo = this.pattern.voices.some((v) => v.solo);
    for (const voice of this.pattern.voices) {
      if (idx >= voice.steps.length) continue;
      const step = voice.steps[idx];
      if (!step.active) continue;
      if (voice.muted) continue;
      if (anySolo && !voice.solo) continue;
      const params: DrumHitParams = {
        volume: voice.volume,
        pan: voice.pan,
        pitch: voice.pitch + step.pitch,
        decay: voice.decay * step.decay,
        tone: voice.tone,
        velocity: step.velocity,
      };
      getDrumSynth().trigger(voice.id as DrumVoiceType, params, t);
    }
  }

  private rafLoop(ctx: AudioContext): void {
    const update = () => {
      if (!this.running || !this.pattern) return;
      // Compute display step from audio time
      const elapsed = ctx.currentTime - (this.nextStepTime - this.stepDur() * this.nextStepIdx);
      const stepCount = this.pattern.stepCount;
      const display = ((Math.floor(elapsed / this.stepDur()) % stepCount) + stepCount) % stepCount;
      this.onStep?.(display);
      this.rafId = requestAnimationFrame(update);
    };
    this.rafId = requestAnimationFrame(update);
  }
}

const scheduler = new DrumScheduler();

// ─── Context menu ─────────────────────────────────────────────────────────────

interface StepMenuProps {
  step: DrumStep;
  x: number; y: number;
  onUpdate: (p: Partial<Pick<DrumStep, 'velocity' | 'pitch' | 'decay'>>) => void;
  onClose: () => void;
}

function StepContextMenu({ step, x, y, onUpdate, onClose }: StepMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-neutral-900 border border-neutral-700 rounded shadow-lg p-3 w-44"
      style={{ left: x, top: y }}
    >
      <div className="text-xs text-neutral-500 tracking-widest mb-2">STEP PARAMS</div>
      <Label label="VEL" value={step.velocity}>
        <input type="range" min={1} max={127} value={step.velocity}
          className="w-full accent-neutral-400"
          onChange={(e) => onUpdate({ velocity: +e.target.value })} />
      </Label>
      <Label label="PITCH" value={`${step.pitch > 0 ? '+' : ''}${step.pitch}`}>
        <input type="range" min={-12} max={12} step={1} value={step.pitch}
          className="w-full accent-neutral-400"
          onChange={(e) => onUpdate({ pitch: +e.target.value })} />
      </Label>
      <Label label="DECAY" value={step.decay.toFixed(1)}>
        <input type="range" min={0.2} max={2.0} step={0.1} value={step.decay}
          className="w-full accent-neutral-400"
          onChange={(e) => onUpdate({ decay: +e.target.value })} />
      </Label>
    </div>
  );
}

interface VoiceMenuProps {
  voice: DrumVoiceConfig;
  x: number; y: number;
  onUpdate: (p: Partial<Omit<DrumVoiceConfig, 'id' | 'name' | 'steps' | 'color'>>) => void;
  onClose: () => void;
}

function VoiceContextMenu({ voice, x, y, onUpdate, onClose }: VoiceMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-neutral-900 border border-neutral-700 rounded shadow-lg p-3 w-48"
      style={{ left: x, top: y }}
    >
      <div className="text-xs tracking-widest mb-2" style={{ color: voice.color }}>{voice.name.toUpperCase()}</div>
      <Label label="VOL" value={Math.round(voice.volume * 100)}>
        <input type="range" min={0} max={1} step={0.01} value={voice.volume}
          className="w-full" style={{ accentColor: voice.color }}
          onChange={(e) => onUpdate({ volume: +e.target.value })} />
      </Label>
      <Label label="PAN" value={voice.pan === 0 ? 'C' : voice.pan > 0 ? `R${Math.round(voice.pan * 100)}` : `L${Math.round(-voice.pan * 100)}`}>
        <input type="range" min={-1} max={1} step={0.01} value={voice.pan}
          className="w-full" style={{ accentColor: voice.color }}
          onChange={(e) => onUpdate({ pan: +e.target.value })} />
      </Label>
      <Label label="TONE" value={Math.round(voice.tone * 100)}>
        <input type="range" min={0} max={1} step={0.01} value={voice.tone}
          className="w-full" style={{ accentColor: voice.color }}
          onChange={(e) => onUpdate({ tone: +e.target.value })} />
      </Label>
      <Label label="PITCH" value={`${voice.pitch > 0 ? '+' : ''}${voice.pitch}`}>
        <input type="range" min={-12} max={12} step={1} value={voice.pitch}
          className="w-full" style={{ accentColor: voice.color }}
          onChange={(e) => onUpdate({ pitch: +e.target.value })} />
      </Label>
      <Label label="DECAY" value={voice.decay.toFixed(1)}>
        <input type="range" min={0.2} max={2.0} step={0.1} value={voice.decay}
          className="w-full" style={{ accentColor: voice.color }}
          onChange={(e) => onUpdate({ decay: +e.target.value })} />
      </Label>
    </div>
  );
}

function Label({ label, value, children }: { label: string; value: number | string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs text-neutral-500 mb-0.5">
        <span>{label}</span><span className="font-mono text-neutral-400">{value}</span>
      </div>
      {children}
    </div>
  );
}

// ─── Voice row ────────────────────────────────────────────────────────────────

interface VoiceRowProps {
  voice: DrumVoiceConfig;
  pattern: DrumPattern;
  currentStep: number;
  isPlaying: boolean;
  onToggleStep: (idx: number) => void;
  onStepRightClick: (idx: number, step: DrumStep, x: number, y: number) => void;
  onVoiceRightClick: (voice: DrumVoiceConfig, x: number, y: number) => void;
  onMute: () => void;
  onSolo: () => void;
}

function VoiceRow({
  voice, pattern, currentStep, isPlaying,
  onToggleStep, onStepRightClick, onVoiceRightClick, onMute, onSolo,
}: VoiceRowProps) {
  const anySolo = pattern.voices.some((v) => v.solo);
  const audible = !voice.muted && (!anySolo || voice.solo);

  return (
    <div className="flex items-center border-b border-neutral-800/60 min-h-[36px]">
      {/* Voice label + mute/solo */}
      <button
        onContextMenu={(e) => { e.preventDefault(); onVoiceRightClick(voice, e.clientX, e.clientY); }}
        className="w-[52px] text-right pr-1 text-xs font-mono truncate shrink-0 cursor-context-menu"
        style={{ color: audible ? voice.color : '#444' }}
        title="Right-click for parameters"
        onClick={(e) => { if (e.button === 0) onVoiceRightClick(voice, e.clientX, e.clientY); }}
      >
        {voice.name}
      </button>
      <div className="flex gap-0.5 mr-2 shrink-0">
        <button
          onClick={onMute}
          className={`w-4 h-4 text-[9px] font-bold border leading-none ${
            voice.muted ? 'border-yellow-500 text-yellow-400' : 'border-neutral-700 text-neutral-600 hover:text-neutral-400'
          }`}
        >M</button>
        <button
          onClick={onSolo}
          style={voice.solo ? { borderColor: voice.color, color: voice.color } : {}}
          className={`w-4 h-4 text-[9px] font-bold border leading-none ${
            !voice.solo ? 'border-neutral-700 text-neutral-600 hover:text-neutral-400' : ''
          }`}
        >S</button>
      </div>

      {/* Step buttons */}
      <div className="flex flex-wrap gap-0.5 flex-1">
        {voice.steps.map((step, i) => {
          const isCurrent = isPlaying && i === currentStep;
          const groupStart = i % 4 === 0 && i !== 0;
          return (
            <button
              key={i}
              title="Left-click to toggle · Right-click for velocity/pitch"
              onClick={() => onToggleStep(i)}
              onContextMenu={(e) => { e.preventDefault(); if (step.active) onStepRightClick(i, step, e.clientX, e.clientY); }}
              className={`w-6 h-6 border transition-colors ${groupStart ? 'ml-1' : ''}`}
              style={{
                backgroundColor: step.active
                  ? isCurrent ? '#fff' : voice.color
                  : isCurrent ? '#333' : 'transparent',
                borderColor: step.active
                  ? voice.color
                  : isCurrent ? '#555' : '#2a2a2a',
                opacity: !audible ? 0.4 : step.active && step.velocity < 80 ? 0.75 : 1,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Main DrumMachine component ───────────────────────────────────────────────

export function DrumMachine() {
  const { state, dispatch } = useDrumStore();
  const { state: appState } = useAppStore();

  const pattern = state.patterns.find((p) => p.id === state.activePatternId)
    ?? state.patterns[0];

  const effectiveBpm = state.syncBpm ? appState.sequencer.bpm : state.bpm;

  // Sync BPM to scheduler
  useEffect(() => {
    scheduler.updateBpm(effectiveBpm);
  }, [effectiveBpm]);

  // Sync pattern to scheduler
  useEffect(() => {
    if (state.isPlaying) scheduler.updatePattern(pattern);
  }, [pattern, state.isPlaying]);

  // Start/stop
  useEffect(() => {
    if (state.isPlaying) {
      scheduler.play(effectiveBpm, pattern, (step) => {
        dispatch({ type: 'DRUM_SET_CURRENT_STEP', step });
      }).catch(console.error);
    } else {
      scheduler.stop();
      dispatch({ type: 'DRUM_SET_CURRENT_STEP', step: 0 });
    }
    return () => { scheduler.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isPlaying]);

  // Context menu state
  const [stepMenu, setStepMenu] = useState<{
    voiceId: DrumVoiceType; stepIndex: number; step: DrumStep; x: number; y: number;
  } | null>(null);
  const [voiceMenu, setVoiceMenu] = useState<{
    voice: DrumVoiceConfig; x: number; y: number;
  } | null>(null);

  const closeMenus = useCallback(() => { setStepMenu(null); setVoiceMenu(null); }, []);

  const handleTogglePlay = useCallback(() => {
    dispatch({ type: 'DRUM_SET_PLAYING', playing: !state.isPlaying });
  }, [state.isPlaying, dispatch]);

  if (!pattern) return null;

  return (
    <div className="flex flex-col border-b border-neutral-800 bg-[#0d0d0d] shrink-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-neutral-800 bg-neutral-900/40">
        <span className="text-xs text-neutral-600 tracking-widest">DRUMS</span>

        {/* Pattern selector */}
        <select
          value={state.activePatternId}
          onChange={(e) => dispatch({ type: 'DRUM_SET_ACTIVE_PATTERN', id: e.target.value })}
          className="bg-neutral-900 border border-neutral-700 text-xs text-neutral-300 px-1 py-0.5"
        >
          {state.patterns.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <button
          onClick={() => dispatch({ type: 'DRUM_ADD_PATTERN' })}
          className="px-1.5 py-0.5 text-xs border border-neutral-700 text-neutral-500 hover:text-neutral-300 hover:border-neutral-500"
          title="New empty pattern"
        >+</button>
        <button
          onClick={() => dispatch({ type: 'DRUM_DUPLICATE_PATTERN', sourceId: pattern.id })}
          className="px-1.5 py-0.5 text-xs border border-neutral-700 text-neutral-500 hover:text-neutral-300 hover:border-neutral-500"
          title="Duplicate pattern"
        >⧉</button>

        {/* Step count */}
        <div className="flex border border-neutral-700 overflow-hidden">
          {([16, 32] as (16 | 32)[]).map((n) => (
            <button
              key={n}
              onClick={() => dispatch({ type: 'DRUM_SET_STEP_COUNT', patternId: pattern.id, steps: n })}
              className={`px-2 py-0.5 text-xs ${
                pattern.stepCount === n
                  ? 'bg-neutral-700 text-neutral-200'
                  : 'text-neutral-600 hover:text-neutral-400'
              }`}
            >{n}</button>
          ))}
        </div>

        {/* Swing */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-neutral-600">SWING</span>
          <input
            type="range" min={0} max={0.5} step={0.01} value={pattern.swing}
            className="w-16 accent-neutral-400"
            onChange={(e) => dispatch({ type: 'DRUM_SET_SWING', patternId: pattern.id, swing: +e.target.value })}
          />
          <span className="text-xs text-neutral-500 font-mono w-6">{Math.round(pattern.swing * 100)}%</span>
        </div>

        {/* Clear */}
        <button
          onClick={() => { if (window.confirm('Clear all steps?')) dispatch({ type: 'DRUM_CLEAR_PATTERN', patternId: pattern.id }); }}
          className="px-2 py-0.5 text-xs border border-neutral-700 text-neutral-600 hover:text-red-400 hover:border-red-800"
        >CLR</button>

        <div className="ml-auto flex items-center gap-2">
          {/* BPM */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-neutral-600">BPM</span>
            <input
              type="number" min={20} max={300} value={state.syncBpm ? appState.sequencer.bpm : state.bpm}
              disabled={state.syncBpm}
              className="w-12 bg-neutral-900 border border-neutral-700 text-xs text-neutral-300 px-1 py-0.5 font-mono text-center disabled:opacity-40"
              onChange={(e) => dispatch({ type: 'DRUM_SET_BPM', bpm: +e.target.value })}
            />
            <button
              onClick={() => dispatch({ type: 'DRUM_SET_SYNC_BPM', sync: !state.syncBpm })}
              className={`px-1.5 py-0.5 text-xs border transition-colors ${
                state.syncBpm
                  ? 'border-green-700 text-green-400 bg-green-900/20'
                  : 'border-neutral-700 text-neutral-600 hover:border-neutral-500'
              }`}
              title="Sync to sequencer BPM"
            >SYNC</button>
          </div>

          {/* Play/stop */}
          <button
            onClick={handleTogglePlay}
            className={`px-3 py-0.5 text-xs border font-bold tracking-widest transition-colors ${
              state.isPlaying
                ? 'border-red-700 text-red-400 bg-red-900/20 hover:bg-red-900/40'
                : 'border-green-700 text-green-400 bg-green-900/20 hover:bg-green-900/40'
            }`}
          >
            {state.isPlaying ? '■ STOP' : '▶ PLAY'}
          </button>
        </div>
      </div>

      {/* Voice grid */}
      <div className="overflow-x-auto overflow-y-auto px-2 py-1" style={{ maxHeight: '280px' }}>
        {pattern.voices.map((voice) => (
          <VoiceRow
            key={voice.id}
            voice={voice}
            pattern={pattern}
            currentStep={state.currentStep}
            isPlaying={state.isPlaying}
            onToggleStep={(idx) => dispatch({
              type: 'DRUM_TOGGLE_STEP',
              patternId: pattern.id, voiceId: voice.id, stepIndex: idx,
            })}
            onStepRightClick={(idx, step, x, y) => {
              closeMenus();
              setStepMenu({ voiceId: voice.id, stepIndex: idx, step, x, y });
            }}
            onVoiceRightClick={(v, x, y) => {
              closeMenus();
              setVoiceMenu({ voice: v, x, y });
            }}
            onMute={() => dispatch({
              type: 'DRUM_MUTE_VOICE',
              patternId: pattern.id, voiceId: voice.id, muted: !voice.muted,
            })}
            onSolo={() => dispatch({
              type: 'DRUM_SOLO_VOICE',
              patternId: pattern.id, voiceId: voice.id, solo: !voice.solo,
            })}
          />
        ))}
      </div>

      {/* Context menus */}
      {stepMenu && (
        <StepContextMenu
          step={stepMenu.step}
          x={stepMenu.x} y={stepMenu.y}
          onUpdate={(params) => {
            dispatch({
              type: 'DRUM_SET_STEP_PARAMS',
              patternId: pattern.id,
              voiceId: stepMenu.voiceId,
              stepIndex: stepMenu.stepIndex,
              params,
            });
            // Refresh the step reference
            setStepMenu((prev) => prev
              ? { ...prev, step: { ...prev.step, ...params } }
              : null);
          }}
          onClose={closeMenus}
        />
      )}
      {voiceMenu && (
        <VoiceContextMenu
          voice={voiceMenu.voice}
          x={voiceMenu.x} y={voiceMenu.y}
          onUpdate={(params) => {
            dispatch({
              type: 'DRUM_SET_VOICE_PARAMS',
              patternId: pattern.id,
              voiceId: voiceMenu.voice.id as DrumVoiceType,
              params,
            });
            setVoiceMenu((prev) => prev
              ? { ...prev, voice: { ...prev.voice, ...params } }
              : null);
          }}
          onClose={closeMenus}
        />
      )}
    </div>
  );
}
