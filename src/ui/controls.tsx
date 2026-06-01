import { type ChangeEvent, type KeyboardEvent, useState, useEffect } from 'react';
import { linearToLogFreq, logFreqToLinear, clamp } from '../utils/math';
import type { Waveform, ColorTheme } from '../utils/math';
import type { OscillatorState, AdvancedSettings } from '../engine/oscillator';

// ─── Shared slider primitive ─────────────────────────────────────────────────

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  color?: string;
  onChange: (v: number) => void;
}

function Slider({ value, min, max, step = 0.001, color = '#00ff88', onChange }: SliderProps) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      className="slider-track w-full"
      style={{ color, accentColor: color }}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(parseFloat(e.target.value))}
    />
  );
}

// ─── Waveform selector ───────────────────────────────────────────────────────

const WAVEFORM_ICONS: Record<Waveform, string> = {
  sine:     '∿',
  square:   '⊓',
  sawtooth: '⋀',
  triangle: '∧',
};

interface WaveformSelectorProps {
  value: Waveform;
  onChange: (w: Waveform) => void;
}

export function WaveformSelector({ value, onChange }: WaveformSelectorProps) {
  const waveforms: Waveform[] = ['sine', 'square', 'sawtooth', 'triangle'];
  return (
    <div className="flex gap-1">
      {waveforms.map((w) => (
        <button
          key={w}
          onClick={() => onChange(w)}
          title={w.charAt(0).toUpperCase() + w.slice(1)}
          className={`
            flex-1 py-2 text-xs uppercase tracking-widest border transition-all duration-100
            ${value === w
              ? 'bg-[#00ff88] text-black border-[#00ff88] font-bold'
              : 'bg-transparent text-neutral-400 border-neutral-700 hover:border-neutral-500 hover:text-neutral-200'
            }
          `}
        >
          <span className="block text-base leading-none mb-0.5">{WAVEFORM_ICONS[w]}</span>
          <span className="block">{w === 'sawtooth' ? 'saw' : w}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Frequency control (log slider + numeric input) ──────────────────────────

interface FrequencyControlProps {
  value: number;
  onChange: (v: number) => void;
}

export function FrequencyControl({ value, onChange }: FrequencyControlProps) {
  const [inputStr, setInputStr] = useState(value.toFixed(1));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setInputStr(value.toFixed(1));
  }, [value, editing]);

  const handleSlider = (linear: number) => {
    onChange(clamp(linearToLogFreq(linear), 20, 20000));
  };

  const commitInput = () => {
    const parsed = parseFloat(inputStr);
    if (!isNaN(parsed)) {
      onChange(clamp(parsed, 20, 20000));
    } else {
      setInputStr(value.toFixed(1));
    }
    setEditing(false);
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitInput();
    if (e.key === 'Escape') {
      setInputStr(value.toFixed(1));
      setEditing(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-baseline">
        <span className="knob-label">Frequency</span>
        <input
          type="text"
          value={inputStr}
          onChange={(e) => { setEditing(true); setInputStr(e.target.value); }}
          onBlur={commitInput}
          onKeyDown={handleKey}
          className="w-24 bg-transparent text-right text-xs font-mono text-[#00ff88] border-b border-neutral-700 focus:border-[#00ff88] outline-none px-1"
          aria-label="Frequency in Hz"
        />
      </div>
      <Slider
        value={logFreqToLinear(value)}
        min={0}
        max={1}
        step={0.0001}
        color="#00ff88"
        onChange={handleSlider}
      />
      <div className="flex justify-between text-neutral-600 text-xs">
        <span>20 Hz</span>
        <span>20 kHz</span>
      </div>
    </div>
  );
}

// ─── Generic labeled slider ──────────────────────────────────────────────────

interface LabeledSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  displayValue: string;
  color?: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}

export function LabeledSlider({
  label, value, min, max, step, displayValue, color = '#00ff88', onChange, disabled
}: LabeledSliderProps) {
  return (
    <div className={`space-y-1 ${disabled ? 'opacity-30 pointer-events-none' : ''}`}>
      <div className="flex justify-between items-baseline">
        <span className="knob-label">{label}</span>
        <span className="control-value" style={{ color }}>{displayValue}</span>
      </div>
      <Slider value={value} min={min} max={max} step={step} color={color} onChange={onChange} />
    </div>
  );
}

// ─── Play / Stop button ──────────────────────────────────────────────────────

interface PlayStopButtonProps {
  isPlaying: boolean;
  onToggle: () => void;
}

export function PlayStopButton({ isPlaying, onToggle }: PlayStopButtonProps) {
  return (
    <button
      onClick={onToggle}
      className={`
        w-full py-3 text-sm uppercase tracking-widest font-bold border-2 transition-all duration-150
        ${isPlaying
          ? 'bg-red-900/40 border-red-500 text-red-400 hover:bg-red-900/60'
          : 'bg-[#00ff88]/10 border-[#00ff88] text-[#00ff88] hover:bg-[#00ff88]/20'
        }
      `}
      aria-label={isPlaying ? 'Stop audio' : 'Start audio'}
    >
      {isPlaying ? '■ STOP' : '▶ PLAY'}
    </button>
  );
}

// ─── Advanced panel ──────────────────────────────────────────────────────────

const THEME_OPTIONS: { value: ColorTheme; label: string; color: string }[] = [
  { value: 'green', label: 'Green', color: '#00ff88' },
  { value: 'amber', label: 'Amber', color: '#ffb000' },
  { value: 'blue',  label: 'Blue',  color: '#00aaff' },
  { value: 'white', label: 'White', color: '#f0f0f0' },
];

interface AdvancedPanelProps {
  advanced: AdvancedSettings;
  onChange: (a: AdvancedSettings) => void;
}

export function AdvancedPanel({ advanced, onChange }: AdvancedPanelProps) {
  const [open, setOpen] = useState(false);
  const set = <K extends keyof AdvancedSettings>(key: K, val: AdvancedSettings[K]) =>
    onChange({ ...advanced, [key]: val });

  return (
    <div className="border-t border-neutral-800">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-1 py-2 text-xs uppercase tracking-widest text-neutral-500 hover:text-neutral-300 transition-colors"
      >
        <span>▾ Advanced</span>
        <span className="text-neutral-700">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="space-y-3 pb-3 px-1">
          <LabeledSlider
            label="Detune"
            value={advanced.centsOffset}
            min={-100} max={100} step={1}
            displayValue={`${advanced.centsOffset > 0 ? '+' : ''}${advanced.centsOffset}¢`}
            color="#aaaaaa"
            onChange={(v) => set('centsOffset', Math.round(v))}
          />
          <LabeledSlider
            label="Zoom (cycles)"
            value={advanced.zoomFactor}
            min={1} max={8} step={0.5}
            displayValue={`${advanced.zoomFactor}×`}
            color="#aaaaaa"
            onChange={(v) => set('zoomFactor', v)}
          />
          <LabeledSlider
            label="Line thickness"
            value={advanced.lineThickness}
            min={1} max={4} step={0.5}
            displayValue={`${advanced.lineThickness}px`}
            color="#aaaaaa"
            onChange={(v) => set('lineThickness', v)}
          />
          <div className="space-y-1">
            <span className="knob-label">Color theme</span>
            <div className="flex gap-1 mt-1">
              {THEME_OPTIONS.map(({ value, label, color }) => (
                <button
                  key={value}
                  onClick={() => set('colorTheme', value)}
                  title={label}
                  className={`
                    flex-1 py-1.5 text-xs border transition-colors
                    ${advanced.colorTheme === value
                      ? 'font-bold'
                      : 'bg-transparent text-neutral-600 border-neutral-700 hover:border-neutral-500'
                    }
                  `}
                  style={advanced.colorTheme === value
                    ? { color, borderColor: color, backgroundColor: color + '18' }
                    : {}
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="knob-label">Show grid</span>
            <button
              onClick={() => set('showGrid', !advanced.showGrid)}
              className={`
                px-3 py-1 text-xs border transition-colors
                ${advanced.showGrid
                  ? 'border-[#00ff88] text-[#00ff88] bg-[#00ff88]/10'
                  : 'border-neutral-700 text-neutral-600'
                }
              `}
            >
              {advanced.showGrid ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Full control panel ──────────────────────────────────────────────────────

interface ControlPanelProps {
  state: OscillatorState;
  advanced: AdvancedSettings;
  onStateChange: (s: OscillatorState) => void;
  onAdvancedChange: (a: AdvancedSettings) => void;
  onTogglePlay: () => void;
}

export function ControlPanel({
  state, advanced, onStateChange, onAdvancedChange, onTogglePlay,
}: ControlPanelProps) {
  const set = <K extends keyof OscillatorState>(key: K, val: OscillatorState[K]) =>
    onStateChange({ ...state, [key]: val });

  const themeColor = {
    green: '#00ff88', amber: '#ffb000', blue: '#00aaff', white: '#f0f0f0',
  }[advanced.colorTheme];

  const phaseDeg = (state.phase * 180 / Math.PI).toFixed(0);

  return (
    <div className="flex flex-col gap-4 p-3 border-t border-neutral-800">
      {/* Row 1: waveform + frequency + amplitude */}
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-1">
          <span className="knob-label">Waveform</span>
          <WaveformSelector value={state.waveform} onChange={(w) => set('waveform', w)} />
        </div>
        <div>
          <FrequencyControl value={state.frequency} onChange={(v) => set('frequency', v)} />
        </div>
        <div>
          <LabeledSlider
            label="Amplitude"
            value={state.amplitude}
            min={0} max={1} step={0.01}
            displayValue={state.amplitude.toFixed(2)}
            color={themeColor}
            onChange={(v) => set('amplitude', v)}
          />
        </div>
      </div>

      {/* Row 2: phase + pulse width + master vol + play */}
      <div className="grid grid-cols-4 gap-4 items-start">
        <LabeledSlider
          label="Phase"
          value={state.phase}
          min={0} max={2 * Math.PI} step={0.01}
          displayValue={`${phaseDeg}°`}
          color={themeColor}
          onChange={(v) => set('phase', v)}
        />
        <LabeledSlider
          label="Pulse width"
          value={state.pulseWidth}
          min={0.01} max={0.99} step={0.01}
          displayValue={`${(state.pulseWidth * 100).toFixed(0)}%`}
          color={themeColor}
          onChange={(v) => set('pulseWidth', v)}
          disabled={state.waveform !== 'square'}
        />
        <LabeledSlider
          label="Master vol"
          value={state.masterVolume}
          min={0} max={1} step={0.01}
          displayValue={`${(state.masterVolume * 100).toFixed(0)}%`}
          color={themeColor}
          onChange={(v) => set('masterVolume', v)}
        />
        <div className="mt-4">
          <PlayStopButton isPlaying={state.isPlaying} onToggle={onTogglePlay} />
        </div>
      </div>

      {/* Advanced panel */}
      <AdvancedPanel advanced={advanced} onChange={onAdvancedChange} />
    </div>
  );
}
