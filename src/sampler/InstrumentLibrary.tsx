import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInstrumentStore } from '../store/instrumentStore';
import { useAppStore } from '../store/appStore';
import {
  getInstrumentEngine, INSTRUMENT_PRESETS, CATEGORIES, OVERRIDE_FIELDS,
  type InstrumentPreset, type InstrumentOverride, type InstrumentCategory,
} from '../engine/instruments';

// ─── Parameter editor (right-click menu) ──────────────────────────────────────

interface ParamMenuProps {
  preset: InstrumentPreset;
  override: InstrumentOverride;
  x: number; y: number;
  onChange: (patch: InstrumentOverride) => void;
  onReset: () => void;
  onClose: () => void;
}

function ParamMenu({ preset, override, x, y, onChange, onReset, onClose }: ParamMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  // Keep the panel on screen
  const top = Math.min(y, Math.max(8, window.innerHeight - 470));
  const left = Math.min(x, Math.max(8, window.innerWidth - 240));

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-neutral-900 border border-neutral-700 rounded shadow-2xl p-3 w-56 max-h-[460px] overflow-y-auto"
      style={{ left, top }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs tracking-widest truncate" style={{ color: preset.color }}>
          {preset.name.toUpperCase()}
        </span>
        <button
          onClick={onReset}
          className="text-xs text-neutral-600 hover:text-neutral-300 border border-neutral-700 px-1"
          title="Restore factory settings"
        >RESET</button>
      </div>

      {(['TONE', 'ENVELOPE', 'MIX'] as const).map((group) => (
        <div key={group} className="mb-2">
          <div className="text-neutral-600 tracking-widest border-b border-neutral-800 mb-1 pb-0.5" style={{ fontSize: 9 }}>
            {group}
          </div>
          {OVERRIDE_FIELDS.filter((f) => f.group === group).map((f) => {
            const value = override[f.key] ?? f.from(preset);
            return (
              <div key={f.key} className="mb-1.5">
                <div className="flex justify-between text-xs text-neutral-500 mb-0.5">
                  <span>{f.label}</span>
                  <span className="font-mono text-neutral-400">{f.format(value)}</span>
                </div>
                <input
                  type="range"
                  min={f.min} max={f.max} step={f.step}
                  value={value}
                  className="w-full"
                  style={{ accentColor: preset.color }}
                  onChange={(e) => onChange({ [f.key]: parseFloat(e.target.value) })}
                />
              </div>
            );
          })}
        </div>
      ))}

      <button
        onClick={() => void getInstrumentEngine().preview(preset.id)}
        className="w-full mt-1 py-1 text-xs border tracking-widest transition-colors"
        style={{ borderColor: preset.color, color: preset.color }}
      >
        ▶ AUDITION
      </button>
    </div>
  );
}

// ─── Preset card ──────────────────────────────────────────────────────────────

interface CardProps {
  preset: InstrumentPreset;
  assignedTo: string[];
  edited: boolean;
  onAudition: () => void;
  onAssign: () => void;
  onContext: (x: number, y: number) => void;
}

function PresetCard({ preset, assignedTo, edited, onAudition, onAssign, onContext }: CardProps) {
  return (
    <div
      onClick={onAudition}
      onContextMenu={(e) => { e.preventDefault(); onContext(e.clientX, e.clientY); }}
      title="Click to audition · Right-click to edit parameters"
      className="group relative flex flex-col justify-between w-[122px] h-[62px] px-2 py-1.5 border border-neutral-800 bg-neutral-900/40 hover:bg-neutral-800/60 hover:border-neutral-600 cursor-pointer transition-colors"
      style={{ borderLeftColor: preset.color, borderLeftWidth: 3 }}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="text-xs text-neutral-200 leading-tight">{preset.name}</span>
        {edited && (
          <span className="text-xs shrink-0" style={{ color: preset.color }} title="Has custom parameters">●</span>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-neutral-600 truncate" style={{ fontSize: 9 }}>
          {assignedTo.length > 0 ? `→ ${assignedTo.join(', ')}` : preset.category}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onAssign(); }}
          className="opacity-0 group-hover:opacity-100 text-xs px-1 border border-neutral-600 text-neutral-400 hover:text-neutral-100 hover:border-neutral-400 transition-opacity shrink-0"
          title="Assign to the selected track"
        >
          SET
        </button>
      </div>
    </div>
  );
}

// ─── Library panel ────────────────────────────────────────────────────────────

export function InstrumentLibrary() {
  const { state, dispatch } = useInstrumentStore();
  const { state: appState } = useAppStore();

  const [targetTab, setTargetTab] = useState<string>(appState.tabs[0]?.id ?? '');
  const [menu, setMenu] = useState<{ preset: InstrumentPreset; x: number; y: number } | null>(null);

  // Keep the target selector pointing at a track that still exists
  useEffect(() => {
    if (!appState.tabs.some((t) => t.id === targetTab)) {
      setTargetTab(appState.tabs[0]?.id ?? '');
    }
  }, [appState.tabs, targetTab]);

  const visible = useMemo(() => {
    const q = state.search.trim().toLowerCase();
    return INSTRUMENT_PRESETS.filter((p) => {
      if (state.category !== 'ALL' && p.category !== state.category) return false;
      if (q && !p.name.toLowerCase().includes(q) && !p.category.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [state.category, state.search]);

  /** presetId → labels of the tracks it's assigned to */
  const assignedLabels = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const [tabId, presetId] of Object.entries(state.assignments)) {
      const tab = appState.tabs.find((t) => t.id === tabId);
      if (!tab) continue;
      const list = map.get(presetId);
      if (list) list.push(tab.label); else map.set(presetId, [tab.label]);
    }
    return map;
  }, [state.assignments, appState.tabs]);

  const audition = useCallback((id: string) => {
    void getInstrumentEngine().preview(id);
  }, []);

  const assign = useCallback((presetId: string) => {
    if (!targetTab) return;
    dispatch({ type: 'INST_ASSIGN', tabId: targetTab, presetId });
  }, [targetTab, dispatch]);

  const assignmentRows = Object.entries(state.assignments)
    .map(([tabId, presetId]) => {
      const tab = appState.tabs.find((t) => t.id === tabId);
      const preset = INSTRUMENT_PRESETS.find((p) => p.id === presetId);
      return tab && preset ? { tab, preset } : null;
    })
    .filter((r): r is { tab: typeof appState.tabs[0]; preset: InstrumentPreset } => r !== null);

  return (
    <div className="flex flex-col border-b border-neutral-800 bg-[#0d0d0d] shrink-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-neutral-800 bg-neutral-900/40 flex-wrap">
        <span className="text-xs text-neutral-600 tracking-widest">INSTRUMENTS</span>

        <input
          type="text"
          value={state.search}
          placeholder="search…"
          onChange={(e) => dispatch({ type: 'INST_SET_SEARCH', search: e.target.value })}
          className="bg-neutral-900 border border-neutral-700 text-xs text-neutral-300 px-1.5 py-0.5 w-28 focus:outline-none focus:border-neutral-500"
        />

        <select
          value={state.category}
          onChange={(e) => dispatch({
            type: 'INST_SET_CATEGORY',
            category: e.target.value as InstrumentCategory | 'ALL',
          })}
          className="bg-neutral-900 border border-neutral-700 text-xs text-neutral-300 px-1 py-0.5"
        >
          <option value="ALL">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <span className="text-xs text-neutral-700 font-mono">{visible.length}</span>

        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-xs text-neutral-600 tracking-widest">ASSIGN TO</span>
          <select
            value={targetTab}
            onChange={(e) => setTargetTab(e.target.value)}
            className="bg-neutral-900 border border-neutral-700 text-xs text-neutral-300 px-1 py-0.5"
          >
            {appState.tabs.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
      </div>

      {/* Active assignments */}
      {assignmentRows.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-1 border-b border-neutral-800/60 bg-neutral-900/20 flex-wrap">
          <span className="text-xs text-neutral-600 tracking-widest">ACTIVE</span>
          {assignmentRows.map(({ tab, preset }) => (
            <span
              key={tab.id}
              className="flex items-center gap-1 px-1.5 py-0.5 text-xs border"
              style={{ borderColor: preset.color + '66', color: preset.color }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tab.color }} />
              {tab.label} → {preset.name}
              <button
                onClick={() => dispatch({ type: 'INST_UNASSIGN', tabId: tab.id })}
                className="ml-0.5 text-neutral-500 hover:text-red-400"
                title="Play this track with its raw oscillator again"
              >×</button>
            </span>
          ))}
        </div>
      )}

      {/* Preset grid */}
      <div className="overflow-y-auto px-2 py-2" style={{ maxHeight: '260px' }}>
        {visible.length === 0 ? (
          <div className="py-6 text-center text-xs text-neutral-600">
            No instruments match “{state.search}”.
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {visible.map((preset) => (
              <PresetCard
                key={preset.id}
                preset={preset}
                assignedTo={assignedLabels.get(preset.id) ?? []}
                edited={!!state.overrides[preset.id]}
                onAudition={() => audition(preset.id)}
                onAssign={() => assign(preset.id)}
                onContext={(x, y) => setMenu({ preset, x, y })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Hint bar */}
      <div className="px-3 py-0.5 border-t border-neutral-800/60 text-neutral-700" style={{ fontSize: 9 }}>
        Click a card to audition · Right-click to edit its parameters · SET assigns it to the chosen track,
        which the sequencer then plays instead of the raw oscillator.
      </div>

      {menu && (
        <ParamMenu
          preset={menu.preset}
          override={state.overrides[menu.preset.id] ?? {}}
          x={menu.x} y={menu.y}
          onChange={(patch) => dispatch({ type: 'INST_SET_OVERRIDE', presetId: menu.preset.id, patch })}
          onReset={() => dispatch({ type: 'INST_RESET_OVERRIDE', presetId: menu.preset.id })}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
