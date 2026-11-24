import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInstrumentStore, type LibraryView } from '../store/instrumentStore';
import { useAppStore } from '../store/appStore';
import {
  getInstrumentEngine, INSTRUMENT_PRESETS, CATEGORIES, OVERRIDE_FIELDS,
  type InstrumentPreset, type InstrumentOverride,
} from '../engine/instruments';
import { toLayout } from '../ui/scale';
import { ContextMenu, type MenuItem } from '../ui/ContextMenu';
import { promptDialog } from '../ui/kit/dialogs';
import { notify } from '../ui/notices';
import { downloadBlob } from '../utils/wav';
import { isUserPresetId, makePack, makeUserPreset, parsePack } from '../utils/userPresets';
import type { InstrumentPatch } from '../utils/music';

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
  /** Save what's shown as one of the user's own sounds. */
  onSave: () => void;
  /** Only for the user's own sounds. */
  onRename?: () => void;
  onDelete?: () => void;
}

function ParamMenu({ preset, override, x, y, trackName, scope, onScope, onChange, onReset, onAudition, onClose, onSave, onRename, onDelete }: ParamMenuProps) {
  const mine = isUserPresetId(preset.id);
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
  const top = Math.min(toLayout(y), Math.max(8, toLayout(window.innerHeight) - 470));
  const left = Math.min(toLayout(x), Math.max(8, toLayout(window.innerWidth) - 240));

  return (
    <div
      ref={ref} role="dialog" aria-label={`${preset.name} settings`}
      className="fixed z-50 bg-neutral-900 border border-neutral-700 rounded-sm shadow-2xl p-3 w-56 max-h-[460px] overflow-y-auto"
      style={{ left, top }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs tracking-widest truncate" style={{ color: preset.color }}>
          {preset.name.toUpperCase()}
        </span>
        <button
          onClick={onReset}
          disabled={mine && scope === 'library'}
          className="text-xs text-neutral-500 hover:text-neutral-300 border border-neutral-700 px-1 disabled:opacity-30"
          title={scope === 'track' ? 'Clear this track\'s own settings' : mine ? 'Your own sounds keep the settings they were saved with' : 'Restore factory settings'}
        >RESET</button>
      </div>

      {/* Scope: a track can sound different from the library default */}
      <div className="flex text-[11px] tracking-widest border border-neutral-800 mb-2" role="group" aria-label="Edit scope">
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
          title={mine ? 'Change the sound itself — every track that plays it' : 'Change the library default — every track using this sound without its own settings'}
        >{mine ? 'SOUND' : 'LIBRARY'}</button>
      </div>

      {(['TONE', 'ENVELOPE', 'MIX'] as const).map((group) => (
        <div key={group} className="mb-2">
          <div className="text-neutral-500 tracking-widest border-b border-neutral-800 mb-1 pb-0.5" style={{ fontSize: 11 }}>
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
                  aria-label={f.label.charAt(0) + f.label.slice(1).toLowerCase()}
                  aria-valuetext={f.format(value)}
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
      <button
        onClick={onSave}
        className="w-full mt-1 py-1 text-xs border border-neutral-700 text-neutral-300 hover:border-neutral-500 tracking-widest"
        title="Keep these settings as a sound of your own, in My sounds"
      >SAVE AS MY SOUND…</button>
      {mine && (
        <div className="flex gap-1 mt-1">
          <button onClick={onRename} className="flex-1 py-1 text-xs border border-neutral-700 text-neutral-400 hover:text-neutral-100 tracking-widest">RENAME…</button>
          <button onClick={onDelete} className="flex-1 py-1 text-xs border border-neutral-700 text-neutral-400 hover:text-red-400 hover:border-red-800 tracking-widest">DELETE</button>
        </div>
      )}
    </div>
  );
}

// ─── Preset card ──────────────────────────────────────────────────────────────

interface CardProps {
  preset: InstrumentPreset;
  favorite: boolean;
  onFavorite: () => void;
  assignedTo: string[];
  /** This is the selected track's current sound. */
  current: boolean;
  canAssign: boolean;
  edited: boolean;
  onAudition: () => void;
  onAssign: () => void;
  onContext: (x: number, y: number) => void;
}

function PresetCard({ preset, favorite, onFavorite, assignedTo, current, canAssign, edited, onAudition, onAssign, onContext }: CardProps) {
  const mine = isUserPresetId(preset.id);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${preset.name}, ${mine ? 'my sound, ' : ''}${preset.category}${current ? ', on this track' : ''} — audition`}
      onClick={onAudition}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAudition(); }
        // The context-menu key (or Shift+F10) opens the parameter editor
        if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          onContext(r.left, r.bottom);
        }
      }}
      onContextMenu={(e) => { e.preventDefault(); onContext(e.clientX, e.clientY); }}
      title="Click to audition · SET gives the selected track this sound · Right-click to edit parameters"
      className="group relative flex flex-col justify-between w-[122px] h-[62px] px-2 py-1.5 border border-neutral-800 bg-neutral-900/40 hover:bg-neutral-800/60 hover:border-neutral-600 cursor-pointer transition-colors"
      style={{
        borderLeftColor: preset.color, borderLeftWidth: 3,
        ...(current ? { borderColor: preset.color, backgroundColor: preset.color + '1f' } : {}),
      }}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="text-xs text-neutral-200 leading-tight">{preset.name}</span>
        <span className="flex items-center gap-1 shrink-0">
          {edited && <span className="text-xs" style={{ color: preset.color }} title="Has custom parameters">●</span>}
          <button
            onClick={(e) => { e.stopPropagation(); onFavorite(); }}
            aria-pressed={favorite}
            aria-label={`Favourite: ${preset.name}`}
            title={favorite ? 'Remove from favourites' : 'Add to favourites'}
            className={`text-xs leading-none ${favorite ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100 text-neutral-500 hover:text-neutral-200'}`}
            style={favorite ? { color: preset.color } : undefined}
          >{favorite ? '★' : '☆'}</button>
        </span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-neutral-500 truncate" style={{ fontSize: 11 }}>
          {assignedTo.length > 0 ? `→ ${assignedTo.join(', ')}` : mine ? `Mine · ${preset.category}` : preset.category}
        </span>
        {current ? (
          <span className="text-[11px] px-1 border shrink-0" style={{ borderColor: preset.color, color: preset.color }}>ON TRACK</span>
        ) : canAssign && (
          <button
            onClick={(e) => { e.stopPropagation(); onAssign(); }}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-xs px-1 border border-neutral-600 text-neutral-400 hover:text-neutral-100 hover:border-neutral-400 transition-opacity shrink-0"
            title="Give the selected track this sound"
            aria-label={`Use ${preset.name} on the selected track`}
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
  const [packMenu, setPackMenu] = useState<{ x: number; y: number } | null>(null);

  const tracks = appState.sequencer.tracks;
  // Presets go on note tracks; drum tracks have their own kit
  const target = tracks.find((t) => t.id === appState.sequencer.selectedTrackId && t.source.type !== 'drums')
    ?? null;

  // The user's own sounds, resolved like factory presets (their name, their settings)
  const mine = useMemo(
    () => state.userPresets.map((p) => getInstrumentEngine().resolve(p.id)).filter((p): p is InstrumentPreset => !!p),
    [state.userPresets],
  );
  const byId = useMemo(() => new Map([...mine, ...INSTRUMENT_PRESETS].map((p) => [p.id, p])), [mine]);

  const visible = useMemo(() => {
    const q = state.search.trim().toLowerCase();
    const view = state.category;
    const list = view === 'FAVORITES' ? state.favorites.map((id) => byId.get(id)).filter((p): p is InstrumentPreset => !!p)
      : view === 'RECENT' ? state.recents.map((id) => byId.get(id)).filter((p): p is InstrumentPreset => !!p)
        : view === 'MINE' ? mine
          : [...mine, ...INSTRUMENT_PRESETS].filter((p) => view === 'ALL' || p.category === view);
    return q ? list.filter((p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)) : list;
  }, [state.category, state.search, state.favorites, state.recents, mine, byId]);

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
    dispatch({ type: 'INST_USED', presetId });
  }, [target, appDispatch, dispatch]);

  const currentPreset = target?.source.type === 'preset' ? target.source.presetId : null;

  // Parameter editor: the selected track's own settings when it plays this
  // preset, otherwise the library default (or, for the user's sound, the sound)
  const menuTrack = menu && currentPreset === menu.preset.id ? target : null;
  const menuUser = menu ? state.userPresets.find((p) => p.id === menu.preset.id) : undefined;
  const libEdits = menu ? (menuUser ? menuUser.patch : state.overrides[menu.preset.id] ?? {}) : {};
  const menuValues = menuTrack && menu?.scope === 'track' ? { ...libEdits, ...menuTrack.patch } : libEdits;
  const openMenu = (preset: InstrumentPreset, x: number, y: number) =>
    setMenu({ preset, x, y, scope: currentPreset === preset.id ? 'track' : 'library' });

  /** Keep the values shown in the editor as a new sound of the user's own. */
  const saveAsMine = async (preset: InstrumentPreset, values: InstrumentPatch, fromTrack: boolean) => {
    const base = getInstrumentEngine().info(preset.id)?.base ?? preset.id;
    const name = await promptDialog({
      title: 'Save as my sound', label: 'Name', value: isUserPresetId(preset.id) ? `${preset.name} 2` : `My ${preset.name}`, confirmLabel: 'Save',
    });
    if (!name?.trim()) return;
    const sound = makeUserPreset(name, base, values);
    dispatch({ type: 'INST_ADD_USER_PRESETS', presets: [sound] });
    // The track's own settings are now the sound: play it, with nothing on top
    if (fromTrack && target) {
      appDispatch({ type: 'SEQ_PUSH_UNDO' });
      appDispatch({ type: 'TRACK_SET_SOURCE', trackId: target.id, source: { type: 'preset', presetId: sound.id } });
      dispatch({ type: 'INST_USED', presetId: sound.id });
    }
    setMenu(null);
    notify(`Saved “${sound.name}” to My sounds${fromTrack && target ? ` — ${target.name} now plays it` : ''}.`);
  };

  const renameMine = async (id: string) => {
    const p = state.userPresets.find((x) => x.id === id);
    if (!p) return;
    const name = await promptDialog({ title: 'Rename sound', label: 'Name', value: p.name, confirmLabel: 'Rename' });
    if (name?.trim()) dispatch({ type: 'INST_UPDATE_USER_PRESET', id, name });
    setMenu(null);
  };

  const deleteMine = (id: string) => {
    const p = state.userPresets.find((x) => x.id === id);
    if (!p) return;
    const users = usedBy.get(id) ?? [];
    if (users.length) {
      notify(`“${p.name}” is played by ${users.join(', ')}. Give ${users.length === 1 ? 'that track' : 'those tracks'} another sound first.`, 'warn');
      return;
    }
    dispatch({ type: 'INST_DELETE_USER_PRESET', id });
    setMenu(null);
    notify(`Deleted “${p.name}”.`, 'info', { label: 'Undo', run: () => dispatch({ type: 'INST_ADD_USER_PRESETS', presets: [p] }) });
  };

  const exportPack = () => {
    const pack = makePack('My sounds', state.userPresets);
    downloadBlob(new Blob([JSON.stringify(pack, null, 1)], { type: 'application/json' }), 'My sounds.oscpack.json');
    notify(`Exported ${pack.presets.length} sound${pack.presets.length === 1 ? '' : 's'} as a pack.`);
  };

  const importPack = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.oscpack,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const pack = parsePack(JSON.parse(await file.text()));
        const fresh = pack.presets.filter((p) => !state.userPresets.some((x) => x.id === p.id));
        dispatch({ type: 'INST_ADD_USER_PRESETS', presets: pack.presets });
        if (fresh.length) dispatch({ type: 'INST_SET_CATEGORY', category: 'MINE' });
        notify(fresh.length
          ? `Added ${fresh.length} sound${fresh.length === 1 ? '' : 's'} from “${pack.name}”${pack.skipped ? ` (${pack.skipped} couldn't be read)` : ''}.`
          : `You already have every sound in “${pack.name}”.`);
      } catch (err) {
        notify(err instanceof SyntaxError ? `${file.name} isn't valid JSON.` : (err as Error).message, 'error');
      }
    };
    input.click();
  };

  const packItems: MenuItem[] = [
    { label: 'Export my sounds as a pack…', disabled: !state.userPresets.length, onSelect: exportPack },
    { label: 'Import a pack…', onSelect: importPack },
  ];

  const viewLabel = (v: LibraryView) => (v === 'FAVORITES' ? 'Favourites' : v === 'RECENT' ? 'Recently used' : v === 'MINE' ? 'My sounds' : v);
  const emptyText = state.search ? `No instruments match “${state.search}”.`
    : state.category === 'FAVORITES' ? 'No favourites yet — hover a card and click ☆ to add one.'
      : state.category === 'RECENT' ? 'Sounds you give to tracks show up here.'
        : state.category === 'MINE' ? 'Your own sounds show up here. Right-click a card, change its settings, and choose “Save as my sound”. Packs from others: Packs ▾ → Import.'
          : 'Nothing here.';

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--surface-1)]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-neutral-800 bg-neutral-900/40 flex-wrap">
        <span className="text-xs text-neutral-500 tracking-widest">INSTRUMENTS</span>

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
          onChange={(e) => dispatch({ type: 'INST_SET_CATEGORY', category: e.target.value as LibraryView })}
          className="bg-neutral-900 border border-neutral-700 text-xs text-neutral-300 px-1 py-0.5"
          aria-label="Category"
        >
          <option value="ALL">All sounds</option>
          <option value="FAVORITES">★ {viewLabel('FAVORITES')} ({state.favorites.length})</option>
          <option value="RECENT">{viewLabel('RECENT')}</option>
          <option value="MINE">{viewLabel('MINE')} ({state.userPresets.length})</option>
          <optgroup label="Categories">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </optgroup>
        </select>
        <button
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPackMenu({ x: r.left, y: r.bottom }); }}
          className="text-xs px-1.5 py-0.5 border border-neutral-700 text-neutral-400 hover:text-neutral-100 hover:border-neutral-500"
          title="Share your sounds as a pack, or add sounds from one"
          aria-haspopup="menu" data-testid="preset-packs"
        >Packs ▾</button>

        <span className="text-xs text-neutral-500 font-mono">{visible.length}</span>

        <div className="ml-auto flex items-center gap-1.5 text-xs">
          {target ? (
            <>
              <span className="text-neutral-500 tracking-widest">TRACK</span>
              <span className="flex items-center gap-1 px-1.5 py-0.5 border" style={{ borderColor: target.color + '88' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: target.color }} />
                <span className="text-neutral-200">{target.name}</span>
              </span>
              <span className="text-neutral-500">— click SET on a card to give it that sound</span>
            </>
          ) : (
            <span className="text-neutral-500">Select an instrument track in the arrangement to assign a sound to it.</span>
          )}
        </div>
      </div>

      {/* Preset grid */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
        {visible.length === 0 ? (
          <div className="py-6 px-4 text-center text-xs text-neutral-500">{emptyText}</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {visible.map((preset) => (
              <PresetCard
                key={preset.id}
                preset={preset}
                favorite={state.favorites.includes(preset.id)}
                onFavorite={() => dispatch({ type: 'INST_TOGGLE_FAVORITE', presetId: preset.id })}
                assignedTo={usedBy.get(preset.id) ?? []}
                current={preset.id === currentPreset}
                canAssign={!!target}
                edited={!isUserPresetId(preset.id) && !!state.overrides[preset.id] || (preset.id === currentPreset && Object.keys(target?.patch ?? {}).length > 0)}
                onAudition={() => audition(preset.id)}
                onAssign={() => assign(preset.id)}
                onContext={(x, y) => openMenu(preset, x, y)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Hint bar */}
      <div className="px-3 py-0.5 border-t border-neutral-800/60 text-neutral-500" style={{ fontSize: 11 }}>
        Click a card to audition · Right-click to edit its parameters or save your own · ☆ favourites · SET gives the selected track that sound.
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
          onSave={() => void saveAsMine(menu.preset, menuValues, !!menuTrack && menu.scope === 'track')}
          onRename={menuUser ? () => void renameMine(menuUser.id) : undefined}
          onDelete={menuUser ? () => deleteMine(menuUser.id) : undefined}
        />
      )}
      {packMenu && <ContextMenu x={packMenu.x} y={packMenu.y} items={packItems} onClose={() => setPackMenu(null)} />}
    </div>
  );
}
