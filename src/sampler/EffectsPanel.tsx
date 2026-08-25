import { useEffectsStore } from '../store/effectsStore';
import { useAppStore } from '../store/appStore';
import { DELAY_DIVISIONS, type DelayDivision, type EffectsSettings } from '../engine/effects';
import { THEME_COLORS } from '../utils/math';

// ─── Small controls ───────────────────────────────────────────────────────────

function Knob({
  label, value, min, max, step, format, color, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; color: string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5 w-[86px]">
      <div className="flex justify-between text-neutral-500" style={{ fontSize: 9 }}>
        <span>{label}</span>
        <span className="font-mono text-neutral-400">{format(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        className="w-full h-1"
        style={{ accentColor: color }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

function Rack({
  title, enabled, color, onToggle, children,
}: {
  title: string; enabled: boolean; color: string;
  onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col gap-1.5 px-2.5 py-2 border min-w-[200px]"
      style={{ borderColor: enabled ? color + '55' : '#262626' }}
    >
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 text-xs tracking-widest transition-colors self-start"
        style={{ color: enabled ? color : '#525252' }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: enabled ? color : '#404040', boxShadow: enabled ? `0 0 5px ${color}` : 'none' }}
        />
        {title}
      </button>
      <div className={`flex flex-wrap gap-x-3 gap-y-1 ${enabled ? '' : 'opacity-35'}`}>
        {children}
      </div>
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function EffectsPanel() {
  const { state, dispatch } = useEffectsStore();
  const { state: appState } = useAppStore();

  const activeTab = appState.tabs.find((t) => t.id === appState.activeTabId) ?? appState.tabs[0];
  const accent = THEME_COLORS[activeTab.advanced.colorTheme];

  const set = (patch: Partial<EffectsSettings>) => dispatch({ type: 'FX_SET', patch });

  const pct = (v: number) => `${Math.round(v * 100)}`;

  return (
    <div className="flex flex-col border-b border-neutral-800 bg-[#0d0d0d] shrink-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-neutral-800 bg-neutral-900/40">
        <span className="text-xs text-neutral-600 tracking-widest">MASTER FX</span>
        <span className="text-neutral-700" style={{ fontSize: 9 }}>
          send effects — every instrument and drum voice feeds these
        </span>
        <button
          onClick={() => dispatch({ type: 'FX_RESET' })}
          className="ml-auto px-2 py-0.5 text-xs border border-neutral-700 text-neutral-500 hover:text-neutral-300 hover:border-neutral-500"
        >
          RESET
        </button>
      </div>

      {/* Racks */}
      <div className="flex flex-wrap gap-2 px-3 py-2">
        {/* ── Reverb ── */}
        <Rack
          title="REVERB" enabled={state.reverbEnabled} color="#8b5cf6"
          onToggle={() => set({ reverbEnabled: !state.reverbEnabled })}
        >
          <Knob
            label="SIZE" value={state.reverbSize} min={0.2} max={8} step={0.1}
            format={(v) => `${v.toFixed(1)}s`} color="#8b5cf6"
            onChange={(v) => set({ reverbSize: v })}
          />
          <Knob
            label="DAMP" value={state.reverbDamp} min={0} max={1} step={0.01}
            format={pct} color="#8b5cf6"
            onChange={(v) => set({ reverbDamp: v })}
          />
          <Knob
            label="RETURN" value={state.reverbMix} min={0} max={1} step={0.01}
            format={pct} color="#8b5cf6"
            onChange={(v) => set({ reverbMix: v })}
          />
        </Rack>

        {/* ── Delay ── */}
        <Rack
          title="DELAY" enabled={state.delayEnabled} color="#06b6d4"
          onToggle={() => set({ delayEnabled: !state.delayEnabled })}
        >
          <div className="flex flex-col gap-0.5 w-[86px]">
            <div className="flex justify-between text-neutral-500" style={{ fontSize: 9 }}>
              <span>TIME</span>
              <button
                onClick={() => set({ delaySync: !state.delaySync })}
                className="font-mono transition-colors"
                style={{ color: state.delaySync ? '#06b6d4' : '#737373' }}
                title="Toggle tempo sync"
              >
                {state.delaySync ? 'SYNC' : 'FREE'}
              </button>
            </div>
            {state.delaySync ? (
              <select
                value={state.delayDivision}
                onChange={(e) => set({ delayDivision: e.target.value as DelayDivision })}
                className="bg-neutral-900 border border-neutral-700 text-neutral-300 px-1 w-full"
                style={{ fontSize: 10 }}
              >
                {DELAY_DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            ) : (
              <input
                type="range" min={20} max={1200} step={5} value={state.delayTimeMs}
                className="w-full h-1" style={{ accentColor: '#06b6d4' }}
                onChange={(e) => set({ delayTimeMs: parseFloat(e.target.value) })}
              />
            )}
          </div>
          <Knob
            label="FEEDBACK" value={state.delayFeedback} min={0} max={0.9} step={0.01}
            format={pct} color="#06b6d4"
            onChange={(v) => set({ delayFeedback: v })}
          />
          <Knob
            label="RETURN" value={state.delayMix} min={0} max={1} step={0.01}
            format={pct} color="#06b6d4"
            onChange={(v) => set({ delayMix: v })}
          />
          <button
            onClick={() => set({ delayPingPong: !state.delayPingPong })}
            className="px-1.5 border self-end mb-0.5 transition-colors"
            style={{
              fontSize: 9,
              borderColor: state.delayPingPong ? '#06b6d4' : '#404040',
              color: state.delayPingPong ? '#06b6d4' : '#737373',
            }}
          >
            PING-PONG
          </button>
        </Rack>

        {/* ── Chorus ── */}
        <Rack
          title="CHORUS" enabled={state.chorusEnabled} color="#22c55e"
          onToggle={() => set({ chorusEnabled: !state.chorusEnabled })}
        >
          <Knob
            label="RATE" value={state.chorusRate} min={0.05} max={8} step={0.05}
            format={(v) => `${v.toFixed(2)}Hz`} color="#22c55e"
            onChange={(v) => set({ chorusRate: v })}
          />
          <Knob
            label="DEPTH" value={state.chorusDepth} min={0} max={1} step={0.01}
            format={pct} color="#22c55e"
            onChange={(v) => set({ chorusDepth: v })}
          />
          <Knob
            label="RETURN" value={state.chorusMix} min={0} max={1} step={0.01}
            format={pct} color="#22c55e"
            onChange={(v) => set({ chorusMix: v })}
          />
        </Rack>

        {/* ── Drum sends ── */}
        <Rack
          title="DRUM SENDS" enabled color="#f97316"
          onToggle={() => { /* always on; levels do the work */ }}
        >
          <Knob
            label="REVERB" value={state.drumReverbSend} min={0} max={1} step={0.01}
            format={pct} color="#f97316"
            onChange={(v) => set({ drumReverbSend: v })}
          />
          <Knob
            label="DELAY" value={state.drumDelaySend} min={0} max={1} step={0.01}
            format={pct} color="#f97316"
            onChange={(v) => set({ drumDelaySend: v })}
          />
          <span className="text-neutral-700 self-end mb-0.5" style={{ fontSize: 9 }}>
            kicks stay dry
          </span>
        </Rack>

        {/* ── Limiter ── */}
        <Rack
          title="LIMITER" enabled={state.limiterEnabled} color={accent}
          onToggle={() => set({ limiterEnabled: !state.limiterEnabled })}
        >
          <Knob
            label="CEILING" value={state.limiterThreshold} min={-40} max={0} step={0.5}
            format={(v) => `${v.toFixed(1)}dB`} color={accent}
            onChange={(v) => set({ limiterThreshold: v })}
          />
          <span className="text-neutral-700 self-end mb-0.5 max-w-[100px] leading-tight" style={{ fontSize: 9 }}>
            catches peaks when layers stack up
          </span>
        </Rack>
      </div>
    </div>
  );
}
