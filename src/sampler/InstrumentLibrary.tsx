import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInstrumentStore } from '../store/instrumentStore';
import { useAppStore } from '../store/appStore';
import {
  getInstrumentEngine, INSTRUMENT_PRESETS, CATEGORIES, OVERRIDE_FIELDS,
  type InstrumentPreset, type InstrumentOverride, type InstrumentCategory,
} from '../engine/instruments';

// ─── Parameter editor (right-click menu) ──────────────────────────────────────

/** What the editor changes: one track's own sound, or the library default for every track. */
type EditScope = 'track' | 'library';

interface ParamMenuProps {
  preset: InstrumentPreset;
  /** Values to show: the edits in effect for the chosen scope. */
  override: InstrumentOverride;
  x: number; y: number;
  /** The selected track, when it plays this preset — enables track scope. */
  trackName: string | null;
  scope: EditScope;
  onScope: (s: EditScope) => void;
  onChange: (patch: InstrumentOverride) => void;
  onReset: () => void;
  onAudition: () => void;
  onClose: () => void;
}

function ParamMenu({ preset, override, x, y, trackName, scope, onScope, onChange, onReset, onAudition, onClose }: ParamMenuProps) {
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
      className="fixed z-50 bg-neutral-900 border border-neutral-700 rounded-sm shadow-2xl p-3 w-56 max-h-[460px] overflow-y-auto"
      style={{ left, top }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs tracking-widest truncate" style={{ color: preset.color }}>
          {preset.name.toUpperCase()}
        </span>
        <button
          onClick={onReset}
          className="text-xs text-neutral-600 hover:text-neutral-300 border border-neutral-700 px-1"
          title={scope === 'track' ? 'Clear this track\'s own settings' : 'Restore factory settings'}
        >RESET</button>
      </div>

      {/* Scope: a track can sound different from the library default */}
      <div className="flex text-[10px] tracking-widest border border-neutral-800 mb-2" role="group" aria-label="Edit scope">
        <button
          disabled={!trackName}
          onClick={() => onScope('track')}
          className={`flex-1 py-0.5 truncate disabled:opacity-30 ${scope === 'track' ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-500'}`}
          aria-pressed={scope === 'track'}
          title={trackName ? `Change only the ${trackName} track` : 'Select a track that uses this sound to give it its own settings'}
        >{trackName ? `TRACK: ${trackName.toUpperCase()}` : 'TRACK'}</button>
        <button
          onClick={() => onScope('library')}
          className={`flex-1 py-0.5 ${scope === 'library' ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-500'}`}
          aria-pressed={scope === 'library'}
          title="Change the library default — every track using this sound without its own settings"
        >LIBRARY</button>
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
        onClick={onAudition}
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
  /** This is the selected track's current sound. */
  current: boolean;
  canAssign: boolean;
  edited: boolean;
  onAudition: () => void;
  onAssign: () => void;
  onContext: (x: number, y: number) => void;
}

function PresetCard({ preset, assignedTo, current, canAssign, edited, onAudition, onAssign, onContext }: CardProps) {
  return (
    <div
      onClick={onAudition}
      onContextMenu={(e) => { e.preventDefault(); onContext(e.clientX, e.clientY); }}
      title="Click to audition · Right-click to edit parameters"
      className="group relative flex flex-col justify-between w-[122px] h-[62px] px-2 py-1.5 border border-neutral-800 bg-neutral-900/40 hover:bg-neutral-800/60 hover:border-neutral-600 cursor-pointer transition-colors"
      style={{
        borderLeftColor: preset.color, borderLeftWidth: 3,
        ...(current ? { borderColor: preset.color, backgroundColor: preset.color + '1f' } : {}),
      }}
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
        {current ? (
          <span className="text-[9px] px-1 border shrink-0" style={{ borderColor: preset.color, color: preset.color }}>ON TRACK</span>
        ) : canAssign && (
          <button
            onClick={(e) => { e.stopPropagation(); onAssign(); }}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-xs px-1 border border-neutral-600 text-neutral-400 hover:text-neutral-100 hover:border-neutral-400 transition-opacity shrink-0"
            title="Give the selected track this sound"
          >
            SET
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Library panel ────────────────────────────────────────────────────────────

export function InstrumentLibrary() {
  const { state, dispatch } = useInstrumentStore();
  const { state: appState, dispatch: appDispatch } = useAppStore();
  const [menu, setMenu] = useState<{ preset: InstrumentPreset; x: number; y: number; scope: EditScope } | null>(null);

  const tracks = appState.sequencer.tracks;
  // Presets go on note tracks; drum tracks have their own kit
  const target = tracks.find((t) => t.id === appState.sequencer.selectedTrackId && t.source.type !== 'drums')
    ?? null;

  const visible = useMemo(() => {
    const q = state.search.trim().toLowerCase();
    return INSTRUMENT_PRESETS.filter((p) => {
      if (state.category !== 'ALL' && p.category !== state.category) return false;
      if (q && !p.name.toLowerCase().includes(q) && !p.category.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [state.category, state.search]);

  /** presetId → names of the tracks that play it */
  const usedBy = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const t of tracks) {
      if (t.source.type !== 'preset') continue;
      const list = map.get(t.source.presetId);
      if (list) list.push(t.name); else map.set(t.source.presetId, [t.name]);
    }
    return map;
  }, [tracks]);

  const audition = useCallback((id: string) => {
    void getInstrumentEngine().preview(id);
  }, []);

  const assign = useCallback((presetId: string) => {
    if (!target) return;
    appDispatch({ type: 'SEQ_PUSH_UNDO' });
    appDispatch({ type: 'TRACK_SET_SOURCE', trackId: target.id, source: { type: 'preset', presetId } });
  }, [target, appDispatch]);

  const currentPreset = target?.source.type === 'preset' ? target.source.presetId : null;

  // Parameter editor: the selected track's own settings when it plays this
  // preset, otherwise the library default
  const menuTrack = menu && currentPreset === menu.preset.id ? target : null;
  const libEdits = menu ? state.overrides[menu.preset.id] ?? {} : {};
  const menuValues = menuTrack && menu?.scope === 'track' ? { ...libEdits, ...menuTrack.patch } : libEdits;
  const openMenu = (preset: InstrumentPreset, x: number, y: number) =>
    setMenu({ preset, x, y, scope: currentPreset === preset.id ? 'track' : 'library' });

  return (
    <div className="flex flex-col h-full min-h-0 bg-[#0d0d0d]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-neutral-800 bg-neutral-900/40 flex-wrap">
        <span className="text-xs text-neutral-600 tracking-widest">INSTRUMENTS</span>

        <input
          type="text"
          value={state.search}
          placeholder="search…"
          onChange={(e) => dispatch({ type: 'INST_SET_SEARCH', search: e.target.value })}
          className="bg-neutral-900 border border-neutral-700 text-xs text-neutral-300 px-1.5 py-0.5 w-28 focus:outline-hidden focus:border-neutral-500"
          aria-label="Search instruments"
        />

        <select
          value={state.category}
          onChange={(e) => dispatch({
            type: 'INST_SET_CATEGORY',
            category: e.target.value as InstrumentCategory | 'ALL',
          })}
          className="bg-neutral-900 border border-neutral-700 text-xs text-neutral-300 px-1 py-0.5"
          aria-label="Category"
        >
          <option value="ALL">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <span className="text-xs text-neutral-700 font-mono">{visible.length}</span>

        <div className="ml-auto flex items-center gap-1.5 text-xs">
          {target ? (
            <>
              <span className="text-neutral-600 tracking-widest">TRACK</span>
              <span className="flex items-center gap-1 px-1.5 py-0.5 border" style={{ borderColor: target.color + '88' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: target.color }} />
                <span className="text-neutral-200">{target.name}</span>
              </span>
              <span className="text-neutral-600">— click SET on a card to give it that sound</span>
            </>
          ) : (
            <span className="text-neutral-600">Select an instrument track in the arrangement to assign a sound to it.</span>
          )}
        </div>
      </div>

      {/* Preset grid */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
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
                assignedTo={usedBy.get(preset.id) ?? []}
                current={preset.id === currentPreset}
                canAssign={!!target}
                edited={!!state.overrides[preset.id] || (preset.id === currentPreset && Object.keys(target?.patch ?? {}).length > 0)}
                onAudition={() => audition(preset.id)}
                onAssign={() => assign(preset.id)}
                onContext={(x, y) => openMenu(preset, x, y)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Hint bar */}
      <div className="px-3 py-0.5 border-t border-neutral-800/60 text-neutral-700" style={{ fontSize: 9 }}>
        Click a card to audition · Right-click to edit its parameters · SET gives the selected track that sound.
      </div>

      {menu && (
        <ParamMenu
          preset={menu.preset}
          override={menuValues}
          x={menu.x} y={menu.y}
          trackName={menuTrack?.name ?? null}
          scope={menuTrack ? menu.scope : 'library'}
          onScope={(scope) => setMenu({ ...menu, scope })}
          onChange={(patch) => (menuTrack && menu.scope === 'track'
            ? appDispatch({ type: 'TRACK_SET_PATCH', trackId: menuTrack.id, patch })
            : dispatch({ type: 'INST_SET_OVERRIDE', presetId: menu.preset.id, patch }))}
          onReset={() => (menuTrack && menu.scope === 'track'
            ? appDispatch({ type: 'TRACK_SET_PATCH', trackId: menuTrack.id, patch: null })
            : dispatch({ type: 'INST_RESET_OVERRIDE', presetId: menu.preset.id }))}
          onAudition={() => void getInstrumentEngine().preview(
            menu.preset.id, menuTrack && menu.scope === 'track' ? menuTrack.patch : undefined)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
