import { useCallback, useEffect, useRef } from 'react';
import { Oscilloscope, type TabRenderInfo } from '../visualizer/oscilloscope';
import { ControlPanel } from './controls';
import { TabBar } from './TabBar';
import { getAudioEngine } from '../engine/audio';
import { useAppStore, computeEffectiveMutes } from '../store/appStore';
import type { OscillatorState, AdvancedSettings } from '../engine/oscillator';
import { readable, useTheme } from './theme';
import { confirmDialog } from './kit/dialogs';

/**
 * The oscillator lab: hands-on waveform synthesis with a live oscilloscope.
 *
 * It's optional. Arrangement tracks don't need it — they play instrument
 * presets — but any lab tab can be used as a track's sound source from the
 * track menu ("Use an oscillator").
 */
export function OscLab() {
  const { state, dispatch } = useAppStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scopeRef = useRef<Oscilloscope | null>(null);

  const activeTab = state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0];
  const theme = useTheme();
  const effectiveMutes = computeEffectiveMutes(state.tabs);
  const usedBy = state.sequencer.tracks.filter(
    (t) => t.source.type === 'oscillator' && t.source.tabId === activeTab.id,
  );

  // ── Scope lifecycle ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scope = new Oscilloscope(canvas, activeTab.oscillator, activeTab.advanced, activeTab.color);
    scopeRef.current = scope;
    const container = canvas.parentElement;
    if (container) { canvas.width = container.clientWidth; canvas.height = container.clientHeight; }
    scope.start();
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) scope.resize(Math.round(e.contentRect.width), Math.round(e.contentRect.height));
    });
    if (container) ro.observe(container);
    return () => { ro.disconnect(); scope.stop(); scopeRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return;
    scope.setOverlayMode(state.overlayMode);
    if (state.overlayMode) {
      const infos: TabRenderInfo[] = state.tabs.map((t) => ({
        id: t.id, label: t.label, color: t.color,
        oscillator: t.oscillator, advanced: t.advanced,
        isMuted: effectiveMutes.get(t.id) ?? false,
        isActive: t.id === state.activeTabId,
      }));
      scope.setTabs(infos);
    } else {
      scope.setState(activeTab.oscillator, activeTab.advanced, activeTab.color);
    }
  }, [state.tabs, state.overlayMode, state.activeTabId, activeTab, effectiveMutes]);

  // Live-monitoring mute/solo for the lab's own drones
  useEffect(() => {
    const engine = getAudioEngine();
    for (const tab of state.tabs) engine.setTabMute(tab.id, effectiveMutes.get(tab.id) ?? false);
  }, [state.tabs, effectiveMutes]);

  // ── Actions ──
  const togglePlay = useCallback(async (tabId: string) => {
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

  const changeOsc = useCallback((id: string, osc: OscillatorState) => {
    dispatch({ type: 'UPDATE_TAB_OSC', id, oscillator: osc });
    const tab = state.tabs.find((t) => t.id === id);
    if (tab?.isPlaying) getAudioEngine().updateTab(id, osc, tab.advanced);
  }, [state.tabs, dispatch]);

  const changeAdvanced = useCallback((id: string, advanced: AdvancedSettings) => {
    dispatch({ type: 'UPDATE_TAB_ADVANCED', id, advanced });
    const tab = state.tabs.find((t) => t.id === id);
    if (tab?.isPlaying) getAudioEngine().updateTab(id, tab.oscillator, advanced);
  }, [state.tabs, dispatch]);

  const removeTab = useCallback(async (id: string) => {
    const tab = state.tabs.find((t) => t.id === id);
    const users = state.sequencer.tracks.filter((t) => t.source.type === 'oscillator' && t.source.tabId === id);
    const msg = users.length
      ? `“${tab?.label}” is the sound of ${users.map((u) => u.name).join(', ')}. Those tracks will switch to Electric Piano.`
      : `“${tab?.label ?? 'oscillator'}” will be removed from the lab.`;
    // Lab tabs aren't part of the undo history, so this one asks first
    const ok = await confirmDialog({ title: 'Remove oscillator', message: msg, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    getAudioEngine().removeTab(id);
    dispatch({ type: 'REMOVE_TAB', id });
  }, [state.tabs, state.sequencer.tracks, dispatch]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center shrink-0 border-b border-neutral-800">
        <div className="flex-1 min-w-0">
          <TabBar
            tabs={state.tabs}
            activeTabId={state.activeTabId}
            onSelect={(id) => dispatch({ type: 'SET_ACTIVE_TAB', id })}
            onAdd={() => dispatch({ type: 'ADD_TAB' })}
            onRemove={removeTab}
            onRename={(id, label) => dispatch({ type: 'SET_TAB_LABEL', id, label })}
            onReorder={(tabs) => dispatch({ type: 'REORDER_TABS', tabs })}
          />
        </div>
        <button
          onClick={() => dispatch({ type: 'SET_OVERLAY_MODE', overlay: !state.overlayMode })}
          className={`mx-2 px-2 py-0.5 text-xs border tracking-widest ${
            state.overlayMode ? 'border-neutral-400 text-neutral-200' : 'border-neutral-700 text-neutral-500 hover:text-neutral-300'
          }`}
          title="Draw every oscillator on one scope"
        >OVERLAY</button>
      </div>

      <div className="px-3 py-1 text-[11px] text-neutral-500 border-b border-neutral-900 shrink-0">
        {usedBy.length
          ? <>Sound source for <span className="text-neutral-300">{usedBy.map((t) => t.name).join(', ')}</span> — changes here change how those tracks sound.</>
          : <>Not used by any track. In the arrangement, a track’s ⋯ menu → “Use an oscillator” plays its notes with this waveform.</>}
      </div>

      <div className="flex-1 relative min-h-0">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      </div>

      <div className="shrink-0">
        <ControlPanel
          state={activeTab.oscillator}
          advanced={activeTab.advanced}
          accentColor={readable(activeTab.color, theme)}
          isPlaying={activeTab.isPlaying}
          isMuted={activeTab.isMuted}
          isSolo={activeTab.solo}
          onStateChange={(osc) => changeOsc(activeTab.id, osc)}
          onAdvancedChange={(adv) => changeAdvanced(activeTab.id, adv)}
          onTogglePlay={() => togglePlay(activeTab.id)}
          onToggleMute={() => dispatch({ type: 'MUTE_TAB', id: activeTab.id, muted: !activeTab.isMuted })}
          onToggleSolo={() => dispatch({ type: 'SOLO_TAB', id: activeTab.id, solo: !activeTab.solo })}
        />
      </div>
    </div>
  );
}
