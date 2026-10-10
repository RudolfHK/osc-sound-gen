import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore, useAccent, findClip } from '../store/appStore';
import { useDrumStore } from '../store/drumStore';
import { useVisualizerStore } from '../store/visualizerStore';
import { getAudioEngine } from '../engine/audio';
import { getSequencerEngine } from '../engine/sequencer';
import { getPlayhead } from '../engine/playhead';
import { THEME_COLORS, type ColorTheme } from '../utils/math';
import { ArrangementView } from '../arrange/ArrangementView';
import { Transport, useTransport } from './Transport';
import { Dock, type DockTab } from './Dock';
import { OscLab } from './OscLab';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { Notices } from './notices';
import { openExport, useExportState } from './exportState';
import { useProjectActions, useDocumentTracking, EXAMPLES } from './useProjectActions';
import { setTheme, useTheme } from './theme';
import { dispatchShortcut, runShortcut, shortcutLabel, useShortcuts, withShortcut } from './shortcuts';
import { helpTopicFor } from './help/topics';
import { useHistory } from './useHistory';
import { ShortcutsOverlay } from './help/ShortcutsOverlay';
import { DialogHost } from './kit/dialogs';
import { getProjectStatus, useProjectStatus } from '../store/projectState';

const VisualizerPanel = lazy(() => import('./VisualizerPanel').then((m) => ({ default: m.VisualizerPanel })));
// The export pipeline (renderer, encoders, zip) loads the first time it's opened
const ExportDialog = lazy(() => import('./ExportDialog').then((m) => ({ default: m.ExportDialog })));
// The guide (and its text) loads the first time help is opened
const HelpPanel = lazy(() => import('./help/HelpPanel'));

interface DesktopBridge {
  isDesktop: true;
  onCommand?: (fn: (id: string) => void) => () => void;
  onCloseRequest?: (fn: () => Promise<boolean>) => () => void;
}
const desktop = (window as unknown as { oscDesktop?: DesktopBridge }).oscDesktop;

function ExportDialogGate() {
  const { open } = useExportState();
  if (!open) return null;
  return <Suspense fallback={null}><ExportDialog /></Suspense>;
}

export function AppShell() {
  const { state, dispatch } = useAppStore();
  const { state: drumState } = useDrumStore();
  const { state: vizState, dispatch: vizDispatch } = useVisualizerStore();
  const accent = useAccent();
  const theme = useTheme();
  const seq = state.sequencer;
  const transport = useTransport();
  const project = useProjectActions();
  const status = useProjectStatus();
  const history = useHistory();
  useDocumentTracking();

  const [dockTab, setDockTab] = useState<DockTab>('editor');
  const [dockHeight, setDockHeight] = useState(300);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; title?: string } | null>(null);

  const openDock = useCallback((tab: DockTab) => {
    setDockTab(tab);
    setDockCollapsed(false);
  }, []);

  // The accent drives the focus ring and other CSS that can't read React state
  useEffect(() => { document.documentElement.style.setProperty('--accent', accent); }, [accent]);

  // ── Engine sync ─────────────────────────────────────────────────────────────
  // Mix settings apply immediately whether or not anything is playing; the
  // arrangement is pushed to the scheduler only while it runs.
  useEffect(() => {
    getSequencerEngine().applyMixState(seq);
  }, [seq.tracks]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!seq.isPlaying) return;
    getSequencerEngine().updateState({ seq, tabs: state.tabs, drumPatterns: drumState.patterns });
  }, [seq.tracks, seq.patterns, seq.bpm, seq.loopEnabled, seq.loopStartBeat, seq.loopEndBeat, // eslint-disable-line react-hooks/exhaustive-deps
    seq.metronome, seq.beatsPerBar, state.tabs, drumState.patterns, seq.isPlaying]);

  useEffect(() => {
    getAudioEngine().setMasterVolume(state.masterVolume);
  }, [state.masterVolume]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  // One listener; what each key does lives in the shortcut registry, so the
  // tooltips, menus and the "?" overlay can't drift from the real behaviour.
  useEffect(() => {
    window.addEventListener('keydown', dispatchShortcut);
    return () => window.removeEventListener('keydown', dispatchShortcut);
  }, []);

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [help, setHelp] = useState<{ open: boolean; topic: string | null }>({ open: false, topic: null });
  const openHelp = useCallback((topic: string | null = null) => setHelp({ open: true, topic }), []);

  // ── Unsaved work ────────────────────────────────────────────────────────────
  // The tab title carries a dot while there are unsaved changes
  useEffect(() => {
    document.title = `${status.dirty ? '• ' : ''}${state.projectName} — OSC`;
  }, [status.dirty, state.projectName]);

  // Browsers ask before closing a tab with unsaved changes. (Electron would
  // silently refuse to close instead, so the desktop app asks through IPC.)
  useEffect(() => {
    if (desktop) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (!getProjectStatus().dirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const confirmDiscard = useRef(project.confirmDiscard);
  confirmDiscard.current = project.confirmDiscard;
  useEffect(() => {
    const offCmd = desktop?.onCommand?.((id) => { runShortcut(id); });
    const offClose = desktop?.onCloseRequest?.(() => confirmDiscard.current('closing'));
    return () => { offCmd?.(); offClose?.(); };
  }, []);

  const selectedClip = findClip(seq, seq.selectedClipId);
  const selectedTrack = seq.tracks.find((tr) => tr.id === seq.selectedTrackId);
  const moveSelection = (delta: number) => {
    const idx = seq.tracks.findIndex((tr) => tr.id === seq.selectedTrackId);
    const next = seq.tracks[Math.max(0, Math.min(seq.tracks.length - 1, idx + delta))];
    if (!next) return false;
    dispatch({ type: 'TRACK_SELECT', trackId: next.id });
  };

  useShortcuts({
    'transport.toggle': () => transport.toggle(),
    'transport.home': () => transport.returnToStart(),
    'transport.loop': () => dispatch({ type: 'SEQ_SET_LOOP', enabled: !seq.loopEnabled }),
    'transport.metronome': () => dispatch({ type: 'SEQ_TOGGLE_METRONOME' }),
    'edit.undo': () => history.undo(),
    'edit.redo': () => history.redo(),
    'file.new': () => { void project.newProject(); },
    'file.save': () => { void project.saveProject(); },
    'file.saveAs': () => { void project.saveProjectAs(); },
    'file.open': () => { void project.openProject(); },
    'file.export': () => openExport('song'),
    'view.editor': () => openDock('editor'),
    'view.mixer': () => openDock('mixer'),
    'view.instruments': () => openDock('instruments'),
    'view.fx': () => openDock('fx'),
    'help.shortcuts': () => setShortcutsOpen(true),
    'help.guide': () => openHelp(helpTopicFor(state.view, dockCollapsed ? null : dockTab)),
    'arrange.delete': () => {
      if (!selectedClip) return false;
      dispatch({ type: 'SEQ_PUSH_UNDO' });
      dispatch({ type: 'CLIP_DELETE', clipId: selectedClip.clip.id });
    },
    'arrange.duplicate': () => {
      if (!selectedClip) return false;
      dispatch({ type: 'SEQ_PUSH_UNDO' });
      dispatch({ type: 'CLIP_DUPLICATE', clipId: selectedClip.clip.id });
    },
    'arrange.split': () => {
      if (!selectedClip) return false;
      dispatch({ type: 'SEQ_PUSH_UNDO' });
      dispatch({ type: 'CLIP_SPLIT', clipId: selectedClip.clip.id, atBeat: seq.isPlaying ? getPlayhead() : seq.playheadBeat });
    },
    'arrange.mute': () => {
      if (!selectedTrack) return false;
      dispatch({ type: 'TRACK_UPDATE', trackId: selectedTrack.id, patch: { muted: !selectedTrack.muted } });
    },
    'arrange.solo': () => {
      if (!selectedTrack) return false;
      dispatch({ type: 'TRACK_UPDATE', trackId: selectedTrack.id, patch: { solo: !selectedTrack.solo } });
    },
    'arrange.prevTrack': () => moveSelection(-1),
    'arrange.nextTrack': () => moveSelection(1),
    'arrange.deselect': () => dispatch({ type: 'CLIP_SELECT', clipId: null }),
  });

  // ── Menus ───────────────────────────────────────────────────────────────────
  const fileMenu = (x: number, y: number) => setMenu({
    x, y,
    items: [
      { label: 'New project', onSelect: () => { void project.newProject(); } },
      { label: 'Open…', shortcut: shortcutLabel('file.open'), onSelect: () => { void project.openProject(); } },
      { label: 'Save', shortcut: shortcutLabel('file.save'), onSelect: () => { void project.saveProject(); } },
      { label: 'Save as…', shortcut: shortcutLabel('file.saveAs'), onSelect: () => { void project.saveProjectAs(); } },
      { label: 'Export audio / MIDI…', shortcut: shortcutLabel('file.export'), onSelect: () => openExport('song') },
      { divider: true, label: '' },
      {
        label: 'Open example',
        submenu: EXAMPLES.map((ex) => ({ label: ex.label, onSelect: () => void project.loadExample(ex.path) })),
      },
    ],
  });

  const helpMenu = (x: number, y: number) => setMenu({
    x, y, title: 'Help',
    items: [
      { label: 'User guide', shortcut: shortcutLabel('help.guide'), onSelect: () => openHelp(helpTopicFor(state.view, dockCollapsed ? null : dockTab)) },
      { label: 'Keyboard shortcuts', shortcut: shortcutLabel('help.shortcuts'), onSelect: () => setShortcutsOpen(true) },
    ],
  });

  const themeMenu = (x: number, y: number) => setMenu({
    x, y, title: 'Accent colour',
    items: (Object.keys(THEME_COLORS) as ColorTheme[]).map((t) => ({
      label: t[0].toUpperCase() + t.slice(1),
      checked: state.uiTheme === t,
      onSelect: () => dispatch({ type: 'SET_UI_THEME', theme: t }),
    })),
  });

  const viewBtn = (v: 'arrange' | 'lab', label: string, short: string, title: string) => (
    <button
      onClick={() => dispatch({ type: 'SET_VIEW', view: v })}
      className="px-2 xl:px-2.5 py-1 text-xs tracking-widest transition-colors whitespace-nowrap"
      style={state.view === v ? { backgroundColor: accent + '22', color: accent } : { color: 'var(--color-neutral-500)' }}
      title={title}
      aria-label={label}
      aria-pressed={state.view === v}
    ><span className="xl:hidden">{short}</span><span className="hidden xl:inline">{label}</span></button>
  );

  return (
    <div className="flex flex-col h-screen bg-[var(--surface-0)] select-none text-neutral-200">
      {/* ── Header ── */}
      {/* One row on a laptop or wider; below that the transport gets its own
          scrollable row instead of wrapping into a tall stack. */}
      <header className="flex items-center gap-x-3 gap-y-1 px-3 py-1.5 border-b border-neutral-800 shrink-0 flex-wrap lg:flex-nowrap"
        style={{ borderBottomColor: accent + '33' }}>
        <div className="flex items-center gap-2 min-w-0 shrink">
          <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden>
            <polyline points="2,16 6,16 8,6 10,26 12,6 14,26 16,16 30,16"
              stroke={accent} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          <button
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); fileMenu(r.left, r.bottom + 2); }}
            className="text-sm font-bold uppercase tracking-widest hover:opacity-80"
            style={{ color: accent }}
            title="File menu"
          >OSC ▾</button>
          <ProjectName />
        </div>

        <div className="order-last lg:order-none w-full lg:w-auto lg:flex-1 flex lg:justify-center-safe min-w-0 overflow-x-auto">
          <Transport />
        </div>

        <div className="flex items-center gap-2 ml-auto lg:ml-0 shrink-0">
          <label className="flex items-center gap-1.5" title="Master volume">
            <span className="hidden min-[1600px]:inline text-xs text-neutral-500 tracking-widest">MASTER</span>
            <input
              type="range" min={0} max={1} step={0.01} value={state.masterVolume}
              aria-label="Master volume"
              className="w-14 xl:w-16" style={{ accentColor: accent }}
              onChange={(e) => dispatch({ type: 'SET_MASTER_VOLUME', volume: parseFloat(e.target.value) })}
            />
          </label>
          <div className="flex border border-neutral-800" role="group" aria-label="Main view">
            {viewBtn('arrange', 'ARRANGE', 'ARR', 'Arrangement — tracks, clips and sections')}
            {viewBtn('lab', 'OSC LAB', 'LAB', 'Oscillator lab — optional waveform synthesis with a scope')}
          </div>
          <button
            onClick={() => vizDispatch({ type: 'VIZ_ENABLE', enabled: !vizState.enabled })}
            className="px-2 py-1 text-xs border tracking-widest transition-colors"
            style={vizState.enabled ? { borderColor: accent, color: accent, backgroundColor: accent + '18' } : { borderColor: 'var(--color-neutral-700)', color: 'var(--color-neutral-500)' }}
            title="Audio visualizer (off by default to save CPU)"
            aria-pressed={vizState.enabled}
          >VIZ</button>
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="w-7 h-7 flex items-center justify-center border border-neutral-700 text-neutral-400 hover:text-neutral-100 hover:border-neutral-500 transition-colors"
            title={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
            aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
            data-testid="theme-toggle"
          >{theme === 'dark' ? '☀' : '☾'}</button>
          <button
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); helpMenu(r.right - 200, r.bottom + 2); }}
            className="w-7 h-7 flex items-center justify-center border border-neutral-700 text-neutral-400 hover:text-neutral-100 hover:border-neutral-500 transition-colors text-sm"
            title={withShortcut('Help — guide and shortcuts', 'help.guide')}
            aria-label="Help"
            data-testid="help-button"
          >?</button>
          <button
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); themeMenu(r.left, r.bottom + 2); }}
            className="w-5 h-5 rounded-full border border-neutral-700"
            style={{ backgroundColor: accent }}
            title="Accent colour"
            aria-label="Accent colour"
          />
        </div>
      </header>

      {vizState.enabled && (
        <Suspense fallback={<div className="h-10" />}>
          <VisualizerPanel />
        </Suspense>
      )}

      {/* ── Main ── */}
      <main className="flex-1 min-h-0">
        {state.view === 'arrange'
          ? <ArrangementView onSeek={transport.seek} openDock={openDock} />
          : <OscLab />}
      </main>

      {state.view === 'arrange' && (
        <Dock
          tab={dockTab}
          onTab={setDockTab}
          height={dockHeight}
          onHeight={setDockHeight}
          collapsed={dockCollapsed}
          onCollapsed={setDockCollapsed}
          onSeek={transport.seek}
        />
      )}

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      <ExportDialogGate />
      {shortcutsOpen && (
        <ShortcutsOverlay
          onClose={() => setShortcutsOpen(false)}
          onOpenGuide={() => openHelp('Keyboard Shortcuts')}
        />
      )}
      {help.open && (
        <Suspense fallback={null}>
          <HelpPanel topic={help.topic} onClose={() => setHelp({ open: false, topic: null })} />
        </Suspense>
      )}
      <DialogHost />
      <Notices />
    </div>
  );
}

function ProjectName() {
  const { state, dispatch } = useAppStore();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(state.projectName);
  useEffect(() => setValue(state.projectName), [state.projectName]);

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => { dispatch({ type: 'SET_PROJECT_NAME', name: value }); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setValue(state.projectName); setEditing(false); }
        }}
        className="w-40 bg-neutral-950 border border-neutral-600 text-xs text-neutral-100 px-1.5 py-0.5"
        aria-label="Project name"
      />
    );
  }
  return (
    <button
      onClick={() => setEditing(true)}
      className="text-xs text-neutral-400 hover:text-neutral-100 max-w-[110px] xl:max-w-[180px] truncate"
      title="Rename project"
    >{state.projectName}</button>
  );
}
