import { useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { useDrumStore } from '../store/drumStore';
import { useEffectsStore, effectsSettingsOf } from '../store/effectsStore';
import { useInstrumentStore } from '../store/instrumentStore';
import { DEFAULT_EFFECTS } from '../engine/effects';
import { parseProject, serializeProject, ProjectError } from '../utils/project';
import { downloadBlob } from '../utils/wav';
import { getSequencerEngine } from '../engine/sequencer';
import { setPlayhead } from '../engine/playhead';
import { notify } from './notices';

/**
 * Example projects ship in /examples and are bundled lazily — each file is
 * only fetched when it's chosen from the menu.
 */
const EXAMPLE_FILES = import.meta.glob('../../examples/*.oscproject', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>;

export const EXAMPLES = Object.keys(EXAMPLE_FILES)
  .map((path) => ({
    path,
    label: path.split('/').pop()!.replace('.oscproject', '').replace(/-/g, ' '),
  }))
  .sort((a, b) => a.label.localeCompare(b.label));

export function useProjectActions() {
  const { state, dispatch } = useAppStore();
  const { state: drumState, dispatch: drumDispatch } = useDrumStore();
  const { state: fxState, dispatch: fxDispatch } = useEffectsStore();
  const { state: instState } = useInstrumentStore();
  const seq = state.sequencer;

  const stopTransport = useCallback(() => {
    getSequencerEngine().stop();
    dispatch({ type: 'SEQ_SET_PLAYING', playing: false });
    setPlayhead(0);
  }, [dispatch]);

  const loadFromText = useCallback((text: string, sourceName: string) => {
    try {
      const project = parseProject(JSON.parse(text));
      stopTransport();
      if (project.drumPatterns.length) {
        drumDispatch({ type: 'DRUM_IMPORT_PATTERNS', patterns: project.drumPatterns });
      }
      dispatch({ type: 'LOAD_PROJECT', project });
      fxDispatch({ type: 'FX_LOAD', settings: project.effects });
      notify(`Loaded “${project.name}”.`);
      for (const w of project.warnings) notify(w, 'warn');
    } catch (err) {
      const msg = err instanceof ProjectError ? err.message
        : err instanceof SyntaxError ? `${sourceName} isn't valid JSON.`
          : `Couldn't open ${sourceName}.`;
      notify(msg, 'error');
      console.error(err);
    }
  }, [dispatch, drumDispatch, fxDispatch, stopTransport]);

  const saveProject = useCallback(() => {
    const project = serializeProject({
      name: state.projectName,
      bpm: seq.bpm,
      beatsPerBar: seq.beatsPerBar,
      songLengthBars: seq.songLengthBars,
      loop: { enabled: seq.loopEnabled, startBeat: seq.loopStartBeat, endBeat: seq.loopEndBeat },
      masterVolume: state.masterVolume,
      doc: { tracks: seq.tracks, patterns: seq.patterns, markers: seq.markers },
      allDrumPatterns: drumState.patterns,
      allOscillators: state.tabs,
      effects: effectsSettingsOf(fxState),
      libraryOverrides: instState.overrides,
    });
    const safe = state.projectName.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'project';
    downloadBlob(new Blob([JSON.stringify(project, null, 1)], { type: 'application/json' }), `${safe}.oscproject`);
    notify(`Saved ${safe}.oscproject`);
  }, [state, seq, drumState.patterns, fxState, instState.overrides]);

  const openProject = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.oscproject,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) loadFromText(await file.text(), file.name);
    };
    input.click();
  }, [loadFromText]);

  const loadExample = useCallback(async (path: string) => {
    const load = EXAMPLE_FILES[path];
    if (!load) return;
    loadFromText(await load(), path.split('/').pop()!);
  }, [loadFromText]);

  const newProject = useCallback(() => {
    const hasContent = seq.tracks.some((t) => t.clips.length > 0);
    if (hasContent && !window.confirm('Start a new project? Unsaved changes to this one will be lost.')) return;
    stopTransport();
    dispatch({ type: 'NEW_PROJECT' });
    fxDispatch({ type: 'FX_LOAD', settings: DEFAULT_EFFECTS });
  }, [seq.tracks, dispatch, fxDispatch, stopTransport]);

  return { saveProject, openProject, loadExample, newProject };
}
