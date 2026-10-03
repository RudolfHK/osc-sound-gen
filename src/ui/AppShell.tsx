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
import { ExportDialog } from './ExportDialog';
import { openExport } from './exportState';
import { getFocusZone, isTypingTarget } from './focus';
import { useProjectActions, EXAMPLES } from './useProjectActions';

const VisualizerPanel = lazy(() => import('./VisualizerPanel').then((m) => ({ default: m.VisualizerPanel })));

export function AppShell() {
  const { state, dispatch } = useAppStore();
  const { state: drumState } = useDrumStore();
  const { state: vizState, dispatch: vizDispatch } = useVisualizerStore();
  const accent = useAccent();
  const seq = state.sequencer;
  const transport = useTransport();
  const project = useProjectActions();

  const [dockTab, setDockTab] = useState<DockTab>('editor');
  const [dockHeight, setDockHeight] = useState(300);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; title?: string } | null>(null);

  const openDock = useCallback((tab: DockTab) => {
    setDockTab(tab);
    setDockCollapsed(false);
  }, []);

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

  // ── Global shortcuts ────────────────────────────────────────────────────────
  const live = useRef({ seq, transport, project, dockTab, dockCollapsed });
  live.current = { seq, transport, project, dockTab, dockCollapsed };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const { seq: s, transport: t, project: p } = live.current;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // Transport and file — everywhere
      if (e.code === 'Space' && !mod) {
        e.preventDefault();
        t.toggle();
        return;
      }
      if (e.key === 'Home') { e.preventDefault(); t.returnToStart(); return; }
      if (mod && key === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'SEQ_REDO' : 'SEQ_UNDO' });
        return;
      }
      if (mod && key === 'y') { e.preventDefault(); dispatch({ type: 'SEQ_REDO' }); return; }
      if (mod && key === 's') { e.preventDefault(); p.saveProject(); return; }
      if (mod && key === 'o') { e.preventDefault(); p.openProject(); return; }
      if (mod && e.shiftKey && key === 'e') { e.preventDefault(); openExport('song'); return; }
      if (e.altKey && !mod) {
        const map: Record<string, DockTab> = { e: 'editor', x: 'mixer', i: 'instruments', f: 'fx' };
        if (map[key]) { e.preventDefault(); openDock(map[key]); return; }
      }

      // The editor owns plain letter keys (they're its computer-keyboard piano)
      if (getFocusZone() === 'editor') return;

      if (!mod && key === 'l') { dispatch({ type: 'SEQ_SET_LOOP', enabled: !s.loopEnabled }); return; }
      if (!mod && key === 'k') { dispatch({ type: 'SEQ_TOGGLE_METRONOME' }); return; }

      const sel = findClip(s, s.selectedClipId);
      const track = s.tracks.find((tr) => tr.id === s.selectedTrackId);

      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
        e.preventDefault();
        dispatch({ type: 'SEQ_PUSH_UNDO' });
        dispatch({ type: 'CLIP_DELETE', clipId: sel.clip.id });
      } else if (mod && key === 'd' && sel) {
        e.preventDefault();
        dispatch({ type: 'SEQ_PUSH_UNDO' });
        dispatch({ type: 'CLIP_DUPLICATE', clipId: sel.clip.id });
      } else if (mod && key === 'e' && sel) {
        e.preventDefault();
        dispatch({ type: 'SEQ_PUSH_UNDO' });
        dispatch({ type: 'CLIP_SPLIT', clipId: sel.clip.id, atBeat: s.isPlaying ? getPlayhead() : s.playheadBeat });
      } else if (!mod && key === 'm' && track) {
        dispatch({ type: 'TRACK_UPDATE', trackId: track.id, patch: { muted: !track.muted } });
      } else if (!mod && key === 's' && track) {
        dispatch({ type: 'TRACK_UPDATE', trackId: track.id, patch: { solo: !track.solo } });
      } else if (e.key === 'Escape') {
        dispatch({ type: 'CLIP_SELECT', clipId: null });
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const idx = s.tracks.findIndex((tr) => tr.id === s.selectedTrackId);
        const next = s.tracks[Math.max(0, Math.min(s.tracks.length - 1, idx + (e.key === 'ArrowUp' ? -1 : 1)))];
        if (next) { e.preventDefault(); dispatch({ type: 'TRACK_SELECT', trackId: next.id }); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, openDock]);

  // ── Menus ───────────────────────────────────────────────────────────────────
  const fileMenu = (x: number, y: number) => setMenu({
    x, y,
    items: [
      { label: 'New project', onSelect: project.newProject },
      { label: 'Open…', shortcut: 'Ctrl+O', onSelect: project.openProject },
      { label: 'Save', shortcut: 'Ctrl+S', onSelect: project.saveProject },
      { label: 'Export audio / MIDI…', shortcut: 'Ctrl+Shift+E', onSelect: () => openExport('song') },
      { divider: true, label: '' },
      {
        label: 'Open example',
        submenu: EXAMPLES.map((ex) => ({ label: ex.label, onSelect: () => void project.loadExample(ex.path) })),
      },
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

  const viewBtn = (v: 'arrange' | 'lab', label: string, title: string) => (
    <button
      onClick={() => dispatch({ type: 'SET_VIEW', view: v })}
      className="px-2.5 py-1 text-xs tracking-widest transition-colors"
      style={state.view === v ? { backgroundColor: accent + '22', color: accent } : { color: '#737373' }}
      title={title}
      aria-pressed={state.view === v}
    >{label}</button>
  );

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a] select-none text-neutral-200">
      {/* ── Header ── */}
      <header className="flex items-center gap-3 px-3 py-1.5 border-b border-neutral-800 shrink-0 flex-wrap"
        style={{ borderBottomColor: accent + '33' }}>
        <div className="flex items-center gap-2">
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

        <div className="flex-1 flex justify-center min-w-0">
          <Transport />
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5" title="Master volume">
            <span className="text-xs text-neutral-600 tracking-widest">MASTER</span>
            <input
              type="range" min={0} max={1} step={0.01} value={state.masterVolume}
              className="w-16" style={{ accentColor: accent }}
              onChange={(e) => dispatch({ type: 'SET_MASTER_VOLUME', volume: parseFloat(e.target.value) })}
            />
          </label>
          <div className="flex border border-neutral-800" role="group" aria-label="Main view">
            {viewBtn('arrange', 'ARRANGE', 'Arrangement — tracks, clips and sections')}
            {viewBtn('lab', 'OSC LAB', 'Oscillator lab — optional waveform synthesis with a scope')}
          </div>
          <button
            onClick={() => vizDispatch({ type: 'VIZ_ENABLE', enabled: !vizState.enabled })}
            className="px-2 py-1 text-xs border tracking-widest transition-colors"
            style={vizState.enabled ? { borderColor: accent, color: accent, backgroundColor: accent + '18' } : { borderColor: '#404040', color: '#737373' }}
            title="Audio visualizer (off by default to save CPU)"
            aria-pressed={vizState.enabled}
          >VIZ</button>
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
      <ExportDialog />
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
      className="text-xs text-neutral-400 hover:text-neutral-100 max-w-[180px] truncate"
      title="Rename project"
    >{state.projectName}</button>
  );
}
