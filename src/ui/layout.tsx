import { useEffect, useRef, useCallback } from 'react';
import { Oscilloscope } from '../visualizer/oscilloscope';
import type { TabRenderInfo } from '../visualizer/oscilloscope';
import { ControlPanel } from './controls';
import { TabBar } from './TabBar';
import { RecordingControls } from './RecordingControls';
import { THEME_COLORS } from '../utils/math';
import { getAudioEngine } from '../engine/audio';
import { getSequencerEngine } from '../engine/sequencer';
import { useAppStore, computeEffectiveMutes } from '../store/appStore';
import { useDrumStore } from '../store/drumStore';
import { useInstrumentStore } from '../store/instrumentStore';
import { useEffectsStore } from '../store/effectsStore';
import type { OscillatorState, AdvancedSettings } from '../engine/oscillator';

export function Layout() {
  const { state, dispatch } = useAppStore();
  const { state: drumState, dispatch: drumDispatch } = useDrumStore();
  const { state: instState, dispatch: instDispatch } = useInstrumentStore();
  const { state: fxState, dispatch: fxDispatch } = useEffectsStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scopeRef = useRef<Oscilloscope | null>(null);

  const activeTab = state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0];
  const effectiveMutes = computeEffectiveMutes(state.tabs);

  // ─── Oscilloscope init ──────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scope = new Oscilloscope(canvas, activeTab.oscillator, activeTab.advanced, activeTab.color);
    scopeRef.current = scope;
    const container = canvas.parentElement;
    if (container) { canvas.width = container.clientWidth; canvas.height = container.clientHeight; }
    scope.start();
    return () => { scope.stop(); scopeRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Push oscilloscope state every render
  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return;
    scope.setOverlayMode(state.overlayMode);

    if (state.overlayMode) {
      const infos: TabRenderInfo[] = state.tabs.map((t) => ({
        id: t.id,
        label: t.label,
        color: t.color,
        oscillator: t.oscillator,
        advanced: t.advanced,
        isMuted: effectiveMutes.get(t.id) ?? false,
        isActive: t.id === state.activeTabId,
      }));
      scope.setTabs(infos);
    } else {
      scope.setState(activeTab.oscillator, activeTab.advanced, activeTab.color);
    }
  });

  // ResizeObserver
  useEffect(() => {
    const container = canvasRef.current?.parentElement;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        scopeRef.current?.resize(Math.round(width), Math.round(height));
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ─── Audio engine sync ──────────────────────────────────────────────────────

  // Sync mute state for all tabs
  useEffect(() => {
    const engine = getAudioEngine();
    for (const tab of state.tabs) {
      const muted = effectiveMutes.get(tab.id) ?? false;
      engine.setTabMute(tab.id, muted);
    }
  }); // runs every render — cheap operation

  // Sync master volume
  useEffect(() => {
    getAudioEngine().setMasterVolume(state.masterVolume);
  }, [state.masterVolume]);

  // Sync sequencer engine when tracks change during playback (undo/redo, note edits)
  useEffect(() => {
    if (state.sequencer.isPlaying) {
      getSequencerEngine().updateState(state.sequencer, state.tabs);
    }
  }, [state.sequencer.tracks]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Tab actions ────────────────────────────────────────────────────────────

  const handleTogglePlay = useCallback(async (tabId: string) => {
    const engine = getAudioEngine();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    if (tab.isPlaying) {
      engine.stopTab(tabId);
      dispatch({ type: 'SET_TAB_PLAYING', id: tabId, playing: false });
    } else {
      try {
        await engine.startTab(tabId, tab.oscillator, tab.advanced);
        dispatch({ type: 'SET_TAB_PLAYING', id: tabId, playing: true });
      } catch (err) {
        console.error('Audio start failed:', err);
      }
    }
  }, [state.tabs, dispatch]);

  const handleStateChange = useCallback((id: string, osc: OscillatorState) => {
    dispatch({ type: 'UPDATE_TAB_OSC', id, oscillator: osc });
    const tab = state.tabs.find((t) => t.id === id);
    if (tab?.isPlaying) {
      getAudioEngine().updateTab(id, osc, tab.advanced);
    }
  }, [state.tabs, dispatch]);

  const handleAdvancedChange = useCallback((id: string, advanced: AdvancedSettings) => {
    dispatch({ type: 'UPDATE_TAB_ADVANCED', id, advanced });
    const tab = state.tabs.find((t) => t.id === id);
    if (tab?.isPlaying) {
      getAudioEngine().updateTab(id, tab.oscillator, advanced);
    }
  }, [state.tabs, dispatch]);

  const handleRemoveTab = useCallback((id: string) => {
    const track = state.sequencer.tracks.find((t) => t.tabId === id);
    const hasNotes = (track?.notes.length ?? 0) > 0;
    const tab = state.tabs.find((t) => t.id === id);
    if (hasNotes && !window.confirm(`Remove "${tab?.label ?? 'oscillator'}" and all its notes?`)) return;
    getAudioEngine().removeTab(id);
    dispatch({ type: 'REMOVE_TAB', id });
  }, [state.sequencer.tracks, state.tabs, dispatch]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  const themeColor = THEME_COLORS[activeTab.advanced.colorTheme];
  const anyPlaying = state.tabs.some((t) => t.isPlaying);

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a] select-none">
      {/* Header */}
      <header
        className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 shrink-0"
        style={{ borderBottomColor: themeColor + '33' }}
      >
        <div className="flex items-center gap-3">
          <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <polyline
              points="2,16 6,16 8,6 10,26 12,6 14,26 16,16 30,16"
              stroke={themeColor} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"
            />
          </svg>
          <h1 className="text-sm font-bold uppercase tracking-widest" style={{ color: themeColor }}>OSC</h1>
          <span className="text-xs text-neutral-600 tracking-widest">DIGITAL OSCILLATOR SYNTHESIZER</span>
        </div>
        <div className="flex items-center gap-4">
          {/* Master volume */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-600 tracking-widest">MASTER</span>
            <input
              type="range" min={0} max={1} step={0.01} value={state.masterVolume}
              className="w-20 slider-track"
              style={{ accentColor: themeColor }}
              onChange={(e) => dispatch({ type: 'SET_MASTER_VOLUME', volume: parseFloat(e.target.value) })}
            />
            <span className="text-xs text-neutral-500 font-mono w-8">
              {Math.round(state.masterVolume * 100)}%
            </span>
          </div>
          {/* Overlay toggle */}
          <button
            onClick={() => dispatch({ type: 'SET_OVERLAY_MODE', overlay: !state.overlayMode })}
            title="Toggle overlay oscilloscope"
            style={state.overlayMode ? { borderColor: themeColor, color: themeColor, backgroundColor: themeColor + '18' } : {}}
            className={`px-2 py-1 text-xs border transition-colors tracking-widest ${
              !state.overlayMode ? 'border-neutral-700 text-neutral-600 hover:border-neutral-500 hover:text-neutral-300' : ''
            }`}
          >
            OVERLAY
          </button>
          {/* Sequencer toggle */}
          <button
            onClick={() => dispatch({ type: 'SEQ_OPEN', open: !state.sequencer.isOpen })}
            style={state.sequencer.isOpen ? { borderColor: themeColor, color: themeColor, backgroundColor: themeColor + '18' } : {}}
            className={`px-2 py-1 text-xs border transition-colors tracking-widest ${
              !state.sequencer.isOpen ? 'border-neutral-700 text-neutral-600 hover:border-neutral-500 hover:text-neutral-300' : ''
            }`}
          >
            SEQUENCER
          </button>
          {/* Drum machine toggle */}
          <button
            onClick={() => drumDispatch({ type: 'DRUM_OPEN', open: !drumState.isOpen })}
            style={drumState.isOpen ? { borderColor: themeColor, color: themeColor, backgroundColor: themeColor + '18' } : {}}
            className={`px-2 py-1 text-xs border transition-colors tracking-widest ${
              !drumState.isOpen ? 'border-neutral-700 text-neutral-600 hover:border-neutral-500 hover:text-neutral-300' : ''
            }`}
          >
            DRUMS
          </button>
          {/* Instrument library toggle */}
          <button
            onClick={() => instDispatch({ type: 'INST_OPEN', open: !instState.isOpen })}
            style={instState.isOpen ? { borderColor: themeColor, color: themeColor, backgroundColor: themeColor + '18' } : {}}
            className={`px-2 py-1 text-xs border transition-colors tracking-widest ${
              !instState.isOpen ? 'border-neutral-700 text-neutral-600 hover:border-neutral-500 hover:text-neutral-300' : ''
            }`}
          >
            INSTRUMENTS
          </button>
          {/* Master effects toggle */}
          <button
            onClick={() => fxDispatch({ type: 'FX_OPEN', open: !fxState.isOpen })}
            style={fxState.isOpen ? { borderColor: themeColor, color: themeColor, backgroundColor: themeColor + '18' } : {}}
            className={`px-2 py-1 text-xs border transition-colors tracking-widest ${
              !fxState.isOpen ? 'border-neutral-700 text-neutral-600 hover:border-neutral-500 hover:text-neutral-300' : ''
            }`}
          >
            FX
          </button>
          {/* Status */}
          <div className="flex items-center gap-2 text-xs text-neutral-600">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: anyPlaying ? '#00ff88' : '#333', boxShadow: anyPlaying ? '0 0 6px #00ff88' : 'none' }}
            />
            <span>{anyPlaying ? 'PLAYING' : 'STOPPED'}</span>
          </div>
        </div>
      </header>

      {/* Tab bar */}
      <TabBar
        tabs={state.tabs}
        activeTabId={state.activeTabId}
        onSelect={(id) => dispatch({ type: 'SET_ACTIVE_TAB', id })}
        onAdd={() => dispatch({ type: 'ADD_TAB' })}
        onRemove={handleRemoveTab}
        onRename={(id, label) => dispatch({ type: 'SET_TAB_LABEL', id, label })}
        onReorder={(tabs) => dispatch({ type: 'REORDER_TABS', tabs })}
      />

      {/* Sequencer panel (lazy import when first opened) */}
      {state.sequencer.isOpen && <SequencerLazy />}

      {/* Drum machine (lazy import when first opened) */}
      {drumState.isOpen && <DrumMachineLazy />}

      {/* Instrument library (lazy import when first opened) */}
      {instState.isOpen && <InstrumentLibraryLazy />}

      {/* Master effects rack (lazy import when first opened) */}
      {fxState.isOpen && <EffectsPanelLazy />}

      {/* Oscilloscope */}
      <div className="flex-1 relative min-h-0">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ imageRendering: 'auto' }} />
      </div>

      {/* Controls for active tab */}
      <div className="shrink-0">
        <ControlPanel
          state={activeTab.oscillator}
          advanced={activeTab.advanced}
          accentColor={activeTab.color}
          isMuted={activeTab.isMuted}
          isSolo={activeTab.solo}
          onStateChange={(osc) => handleStateChange(activeTab.id, osc)}
          onAdvancedChange={(adv) => handleAdvancedChange(activeTab.id, adv)}
          onTogglePlay={() => handleTogglePlay(activeTab.id)}
          onToggleMute={() => dispatch({ type: 'MUTE_TAB', id: activeTab.id, muted: !activeTab.isMuted })}
          onToggleSolo={() => dispatch({ type: 'SOLO_TAB', id: activeTab.id, solo: !activeTab.solo })}
        />
      </div>

      {/* Recording controls */}
      <RecordingControls
        isRecording={state.isRecording}
        onSetRecording={(v) => dispatch({ type: 'SET_RECORDING', recording: v })}
      />
    </div>
  );
}

// ─── Lazy wrappers ────────────────────────────────────────────────────────────

import { lazy, Suspense } from 'react';

const SequencerPanelLazy = lazy(() =>
  import('../sequencer/SequencerPanel').then((m) => ({ default: m.SequencerPanel }))
);
function SequencerLazy() {
  return (
    <Suspense fallback={
      <div className="h-64 flex items-center justify-center text-xs text-neutral-600 tracking-widest">
        LOADING SEQUENCER…
      </div>
    }>
      <SequencerPanelLazy />
    </Suspense>
  );
}

const DrumMachineLazyComp = lazy(() =>
  import('../sampler/DrumMachine').then((m) => ({ default: m.DrumMachine }))
);
function DrumMachineLazy() {
  return (
    <Suspense fallback={
      <div className="h-20 flex items-center justify-center text-xs text-neutral-600 tracking-widest">
        LOADING DRUMS…
      </div>
    }>
      <DrumMachineLazyComp />
    </Suspense>
  );
}

const InstrumentLibraryLazyComp = lazy(() =>
  import('../sampler/InstrumentLibrary').then((m) => ({ default: m.InstrumentLibrary }))
);
function InstrumentLibraryLazy() {
  return (
    <Suspense fallback={
      <div className="h-20 flex items-center justify-center text-xs text-neutral-600 tracking-widest">
        LOADING INSTRUMENTS…
      </div>
    }>
      <InstrumentLibraryLazyComp />
    </Suspense>
  );
}

const EffectsPanelLazyComp = lazy(() =>
  import('../sampler/EffectsPanel').then((m) => ({ default: m.EffectsPanel }))
);
function EffectsPanelLazy() {
  return (
    <Suspense fallback={
      <div className="h-20 flex items-center justify-center text-xs text-neutral-600 tracking-widest">
        LOADING FX…
      </div>
    }>
      <EffectsPanelLazyComp />
    </Suspense>
  );
}
