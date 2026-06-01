import { useCallback, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { TransportBar } from './TransportBar';
import { TrackHeader } from './TrackHeader';
import { PianoRoll } from './PianoRoll';
import { Mixer } from './Mixer';
import { THEME_COLORS } from '../utils/math';
import { downloadBlob } from '../utils/wav';
import type { SequencerProject } from '../utils/music';

const TRACK_HEIGHT_DEFAULT = 120;
const TRACK_HEIGHT_MIN = 60;
const TRACK_HEIGHT_MAX = 400;

export function SequencerPanel() {
  const { state, dispatch } = useAppStore();
  const seq = state.sequencer;
  const activeTab = state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0];
  const accent = THEME_COLORS[activeTab.advanced.colorTheme];
  const [showMixer, setShowMixer] = useState(false);
  const [activeTrackId, setActiveTrackId] = useState<string>(state.tabs[0]?.id ?? '');
  const [trackHeight, setTrackHeight] = useState(TRACK_HEIGHT_DEFAULT);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null);

  const activeTrackTab = state.tabs.find((t) => t.id === activeTrackId) ?? state.tabs[0];
  const activeTrackData = seq.tracks.find((t) => t.tabId === activeTrackId) ?? seq.tracks[0];

  // ─── Track height resize ─────────────────────────────────────────────────────

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    resizeRef.current = { startY: e.clientY, startH: trackHeight };
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const dy = ev.clientY - resizeRef.current.startY;
      setTrackHeight(Math.max(TRACK_HEIGHT_MIN, Math.min(TRACK_HEIGHT_MAX, resizeRef.current.startH + dy)));
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [trackHeight]);

  // ─── Project save/load ───────────────────────────────────────────────────────

  const saveProject = useCallback(() => {
    const project: SequencerProject = {
      version: '1.0',
      name: 'Untitled',
      savedAt: new Date().toISOString(),
      bpm: seq.bpm,
      beatsPerBar: seq.beatsPerBar,
      songLengthBars: seq.songLengthBars,
      // Use stable index-based tabIds so projects load correctly across sessions
      tracks: seq.tracks.map((t, i) => ({ ...t, tabId: String(i) })),
      masterVolume: state.masterVolume,
    };
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `osc-project-${Date.now()}.oscproject`);
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
  }, [seq, state.masterVolume]);

  const [loadError, setLoadError] = useState<string | null>(null);

  const loadProject = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.oscproject,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setLoadError(null);
      try {
        const text = await file.text();
        const project = JSON.parse(text) as Partial<SequencerProject>;
        if (project.version !== '1.0') {
          setLoadError(`Unknown project version "${project.version ?? 'none'}". Some data may not load correctly.`);
        }
        if (!project.bpm || !project.tracks) {
          setLoadError('Invalid project file: missing required fields.');
          return;
        }
        dispatch({ type: 'LOAD_PROJECT', project: project as SequencerProject });
      } catch (err) {
        setLoadError('Failed to parse project file. Is it a valid .oscproject?');
        console.error(err);
      }
    };
    input.click();
  }, [dispatch]);

  if (!activeTrackTab || !activeTrackData) {
    return (
      <div className="h-64 flex items-center justify-center text-xs text-neutral-600 border-b border-neutral-800">
        No tracks — add an oscillator to get started.
      </div>
    );
  }

  return (
    <div className="flex flex-col border-b border-neutral-800 bg-[#0d0d0d]" style={{ maxHeight: '60vh' }}>
      {/* Transport */}
      <TransportBar />

      {/* Toolbar: track selector + project actions */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-neutral-800 bg-neutral-900/40 shrink-0">
        <span className="text-xs text-neutral-600 tracking-widest">TRACK</span>
        {state.tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTrackId(tab.id)}
            style={activeTrackId === tab.id ? { borderColor: tab.color, color: tab.color, backgroundColor: tab.color + '18' } : {}}
            className={`flex items-center gap-1.5 px-2 py-0.5 text-xs border transition-colors ${
              activeTrackId !== tab.id ? 'border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300' : ''
            }`}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tab.color }} />
            {tab.label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-1.5">
          {loadError && (
            <span className="text-xs text-red-400 font-mono max-w-[220px] truncate" title={loadError}>
              ⚠ {loadError}
            </span>
          )}
          <button
            onClick={() => setShowMixer((s) => !s)}
            style={showMixer ? { borderColor: accent, color: accent, backgroundColor: accent + '18' } : {}}
            className={`px-2 py-0.5 text-xs border tracking-widest transition-colors ${
              !showMixer ? 'border-neutral-700 text-neutral-600 hover:border-neutral-500 hover:text-neutral-300' : ''
            }`}
          >
            MIXER
          </button>
          <button
            onClick={saveProject}
            className="px-2 py-0.5 text-xs border border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300 transition-colors"
          >
            {saveStatus === 'saved' ? '✓ SAVED' : '↓ SAVE'}
          </button>
          <button
            onClick={loadProject}
            className="px-2 py-0.5 text-xs border border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300 transition-colors"
          >
            ↑ LOAD
          </button>
        </div>
      </div>

      {/* Main area: track header + piano roll */}
      <div className="flex flex-1 overflow-hidden">
        {/* Track header sidebar */}
        <div className="shrink-0">
          <TrackHeader tab={activeTrackTab} track={activeTrackData} height={trackHeight} />
        </div>

        {/* Piano roll canvas */}
        <div className="flex-1 overflow-hidden">
          <PianoRoll
            tab={activeTrackTab}
            track={activeTrackData}
            accent={accent}
            height={trackHeight}
          />
        </div>
      </div>

      {/* Resize handle */}
      <div
        className="h-1.5 bg-neutral-800 hover:bg-neutral-600 cursor-row-resize transition-colors shrink-0 flex items-center justify-center"
        onMouseDown={handleResizeStart}
        title="Drag to resize piano roll"
      >
        <div className="w-8 h-0.5 bg-neutral-600 rounded" />
      </div>

      {/* Mixer */}
      {showMixer && <Mixer />}
    </div>
  );
}
