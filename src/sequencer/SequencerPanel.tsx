import { useCallback, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { TransportBar } from './TransportBar';
import { TrackHeader } from './TrackHeader';
import { PianoRoll } from './PianoRoll';
import { Mixer } from './Mixer';
import { THEME_COLORS } from '../utils/math';
import { downloadBlob } from '../utils/wav';
import type { SequencerProject } from '../utils/music';

const TRACK_HEIGHT = 120; // pixels per track lane in the piano roll

export function SequencerPanel() {
  const { state, dispatch } = useAppStore();
  const seq = state.sequencer;
  const activeTab = state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0];
  const accent = THEME_COLORS[activeTab.advanced.colorTheme];
  const [showMixer, setShowMixer] = useState(false);
  const [activeTrackId, setActiveTrackId] = useState<string>(state.tabs[0]?.id ?? '');

  const activeTrackTab = state.tabs.find((t) => t.id === activeTrackId) ?? state.tabs[0];
  const activeTrackData = seq.tracks.find((t) => t.tabId === activeTrackId) ?? seq.tracks[0];

  // ─── Project save/load ───────────────────────────────────────────────────────

  const saveProject = useCallback(() => {
    const project: SequencerProject = {
      version: '1.0',
      name: 'Untitled',
      savedAt: new Date().toISOString(),
      bpm: seq.bpm,
      beatsPerBar: seq.beatsPerBar,
      songLengthBars: seq.songLengthBars,
      tracks: seq.tracks,
      masterVolume: state.masterVolume,
    };
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `osc-project-${Date.now()}.oscproject`);
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
    <div className="flex flex-col border-b border-neutral-800 bg-[#0d0d0d]" style={{ maxHeight: '55vh' }}>
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
            ↓ SAVE
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
          <TrackHeader tab={activeTrackTab} track={activeTrackData} height={TRACK_HEIGHT} />
        </div>

        {/* Piano roll canvas */}
        <div className="flex-1 overflow-hidden">
          <PianoRoll
            tab={activeTrackTab}
            track={activeTrackData}
            accent={accent}
            height={TRACK_HEIGHT}
          />
        </div>
      </div>

      {/* Mixer */}
      {showMixer && <Mixer />}
    </div>
  );
}
