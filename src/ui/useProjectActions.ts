import { useCallback, useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { useDrumStore } from '../store/drumStore';
import { useEffectsStore, effectsSettingsOf } from '../store/effectsStore';
import { useInstrumentStore } from '../store/instrumentStore';
import { DEFAULT_EFFECTS } from '../engine/effects';
import { parseProject, serializeProject, ProjectError, type LoadedProject } from '../utils/project';
import { makeTemplate } from '../utils/templates';
import { downloadBlob } from '../utils/wav';
import { getSequencerEngine } from '../engine/sequencer';
import { setPlayhead } from '../engine/playhead';
import {
  getProjectStatus, markReplaced, markSaved, setProjectSerializer, setSaving, trackDocument,
} from '../store/projectState';
import { getSettings } from '../store/settings';
import { notify } from './notices';
import { choiceDialog } from './kit/dialogs';
import { EXAMPLES, TEMPLATES, loadExampleText } from './examples';

// ─── Files ────────────────────────────────────────────────────────────────────
// Chromium browsers (and the desktop app) can write back to the file a project
// came from — the File System Access API. Elsewhere Save downloads a copy, and
// says so each time.

interface PickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}
type PermissionHandle = FileSystemFileHandle & {
  queryPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
};
const fsa = window as unknown as {
  showSaveFilePicker?: (o?: PickerOptions) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (o?: PickerOptions) => Promise<FileSystemFileHandle[]>;
};
const FILE_TYPES = [{ description: 'OSC project', accept: { 'application/json': ['.oscproject', '.json'] } }];

/** The file Save writes to. Lost on reload, like any editor's open-file handle. */
let fileHandle: FileSystemFileHandle | null = null;

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

async function writeFile(handle: FileSystemFileHandle, text: string): Promise<void> {
  setSaving(true);
  try { await write(handle, text); } finally { setSaving(false); }
}

async function write(handle: FileSystemFileHandle, text: string): Promise<void> {
  const h = handle as PermissionHandle;
  // A file that was opened (read access) needs permission before writing
  if (h.queryPermission && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    if ((await h.requestPermission?.({ mode: 'readwrite' })) !== 'granted') {
      throw new DOMException('Write permission denied', 'NotAllowedError');
    }
  }
  const out = await handle.createWritable();
  await out.write(text);
  await out.close();
}

function fileNameFor(projectName: string): string {
  const safe = projectName.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'project';
  return `${safe}.oscproject`;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Keep the unsaved-changes flag current. Called once, from the app shell.
 * The signature lists everything a project file stores.
 */
export function useDocumentTracking(): void {
  const { state } = useAppStore();
  const { state: drumState } = useDrumStore();
  const { state: fxState } = useEffectsStore();
  const { state: instState } = useInstrumentStore();
  const seq = state.sequencer;

  // Cheap enough to run after every render: a short array of references
  useEffect(() => {
    trackDocument([
      seq.tracks, seq.patterns, seq.markers,
      seq.bpm, seq.beatsPerBar, seq.songLengthBars,
      seq.loopEnabled, seq.loopStartBeat, seq.loopEndBeat,
      state.projectName, state.masterVolume,
      drumState.patterns, instState.overrides,
      ...state.tabs.flatMap((t) => [t.oscillator, t.advanced, t.label]),
      ...Object.values(effectsSettingsOf(fxState)),
    ]);
  });
}

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

  /** Replace the song with a parsed project. */
  const applyProject = useCallback((project: LoadedProject) => {
    stopTransport();
    if (project.drumPatterns.length) {
      drumDispatch({ type: 'DRUM_IMPORT_PATTERNS', patterns: project.drumPatterns });
    }
    dispatch({ type: 'LOAD_PROJECT', project });
    fxDispatch({ type: 'FX_LOAD', settings: project.effects });
  }, [dispatch, drumDispatch, fxDispatch, stopTransport]);

  /** Replace the song with a project file's contents. False if it couldn't be read. */
  const loadFromText = useCallback((text: string, sourceName: string): boolean => {
    try {
      const project = parseProject(JSON.parse(text));
      applyProject(project);
      notify(`Loaded “${project.name}”.`);
      for (const w of project.warnings) notify(w, 'warn');
      return true;
    } catch (err) {
      const msg = err instanceof ProjectError ? err.message
        : err instanceof SyntaxError ? `${sourceName} isn't valid JSON.`
          : `Couldn't open ${sourceName}.`;
      notify(msg, 'error');
      console.error(err);
      return false;
    }
  }, [applyProject]);

  const buildProject = useCallback(() => {
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
    return { name: fileNameFor(state.projectName), text: JSON.stringify(project, null, 1) };
  }, [state, seq, drumState.patterns, fxState, instState.overrides]);

  // The crash screen saves through this, after React has given up
  useEffect(() => { setProjectSerializer(buildProject); }, [buildProject]);

  /** Choose a file and write the project to it. Resolves false if cancelled. */
  const saveProjectAs = useCallback(async (): Promise<boolean> => {
    const { name, text } = buildProject();
    if (fsa.showSaveFilePicker) {
      try {
        const handle = await fsa.showSaveFilePicker({ suggestedName: name, types: FILE_TYPES });
        await writeFile(handle, text);
        fileHandle = handle;
        markSaved(handle.name);
        notify(`Saved ${handle.name}`);
        return true;
      } catch (err) {
        if (isAbort(err)) return false;
        // No permission, or no user gesture left (e.g. after another dialog): download instead
        console.warn('Saving through the file picker failed; downloading instead.', err);
      }
    }
    downloadBlob(new Blob([text], { type: 'application/json' }), name);
    markSaved(name);
    notify(`This browser can't save over a file, so a copy was downloaded as ${name}. Open that file next time to carry on.`);
    return true;
  }, [buildProject]);

  /** Write over the project's file, or ask where to save the first time. */
  const saveProject = useCallback(async (): Promise<boolean> => {
    if (fileHandle) {
      const { text } = buildProject();
      try {
        await writeFile(fileHandle, text);
        markSaved(fileHandle.name);
        notify(`Saved ${fileHandle.name}`);
        return true;
      } catch (err) {
        if (isAbort(err)) return false;
        console.warn(`Couldn't write ${fileHandle.name}; asking where to save.`, err);
        fileHandle = null;
      }
    }
    return saveProjectAs();
  }, [buildProject, saveProjectAs]);

  /**
   * Autosave (Settings): write unsaved changes to the project's file. Only
   * when there is a file to write to — it never opens a file picker.
   */
  const autosave = useCallback(async (): Promise<void> => {
    if (!fileHandle || !getProjectStatus().dirty) return;
    try {
      await writeFile(fileHandle, buildProject().text);
      markSaved(fileHandle.name);
    } catch (err) {
      console.warn('Autosave failed.', err);
    }
  }, [buildProject]);

  /** Is there a file that Save (and autosave) writes to? */
  const hasFile = useCallback(() => fileHandle !== null, []);

  /**
   * Before something replaces the song: if it has unsaved changes, offer to
   * save them. Resolves true when it's fine to go ahead.
   */
  const confirmDiscard = useCallback(async (doing: string): Promise<boolean> => {
    if (!getProjectStatus().dirty) return true;
    const answer = await choiceDialog({
      title: 'Unsaved changes',
      message: `“${state.projectName}” has changes that haven't been saved. Save them before ${doing}?`,
      choices: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'discard', label: "Don't save", danger: true },
        { id: 'save', label: 'Save', primary: true },
      ],
    });
    if (answer === 'save') return saveProject();
    return answer === 'discard';
  }, [state.projectName, saveProject]);

  const openProject = useCallback(async () => {
    if (!(await confirmDiscard('opening another project'))) return;
    if (fsa.showOpenFilePicker) {
      try {
        const [handle] = await fsa.showOpenFilePicker({ types: FILE_TYPES });
        const file = await handle.getFile();
        if (loadFromText(await file.text(), file.name)) {
          fileHandle = handle;
          markReplaced(handle.name);
        }
        return;
      } catch (err) {
        if (isAbort(err)) return;
        // The picker needs a fresh click if a dialog came first
        if (err instanceof DOMException && (err.name === 'SecurityError' || err.name === 'NotAllowedError')) {
          notify('Choose Open… again to pick the project.');
          return;
        }
        console.warn('File picker unavailable; using the file input.', err);
      }
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.oscproject,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file && loadFromText(await file.text(), file.name)) {
        fileHandle = null;
        markReplaced(file.name);
      }
    };
    input.click();
  }, [confirmDiscard, loadFromText]);

  /** Open a bundled example (by file name). Resolves true once it's loaded. */
  const loadExample = useCallback(async (file: string): Promise<boolean> => {
    if (!EXAMPLES.some((e) => e.file === file)) return false;
    if (!(await confirmDiscard('opening the example'))) return false;
    // An example is a starting point: Save asks where to put the copy
    if (!loadFromText(await loadExampleText(file), file)) return false;
    fileHandle = null;
    markReplaced(null);
    return true;
  }, [confirmDiscard, loadFromText]);

  /** Start over: the starter tracks, or no tracks at all. Tempo and grid come from Settings. */
  const startNew = useCallback((empty: boolean) => {
    const s = getSettings();
    stopTransport();
    dispatch({
      type: 'NEW_PROJECT', empty,
      defaults: { bpm: s.newTempo, snapValue: s.newSnap, defaultNoteLength: s.newNoteLength },
    });
    fxDispatch({ type: 'FX_LOAD', settings: DEFAULT_EFFECTS });
    fileHandle = null;
    markReplaced(null);
  }, [dispatch, fxDispatch, stopTransport]);

  /** A genre's tracks, sounds, mix and beat with no notes yet. */
  const newFromTemplate = useCallback(async (id: string, ask = true): Promise<boolean> => {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return false;
    if (ask && !(await confirmDiscard('starting a new project'))) return false;
    try {
      applyProject(makeTemplate(parseProject(JSON.parse(await loadExampleText(t.from))), t.title));
    } catch (err) {
      notify(`Couldn't build the ${t.title} template.`, 'error');
      console.error(err);
      return false;
    }
    fileHandle = null;
    markReplaced(null);
    notify(`New ${t.title} project: the beat loops over the first bars — add notes on any track.`);
    return true;
  }, [applyProject, confirmDiscard]);

  /** New project the way Settings says: starter tracks, empty, or a template. */
  const newProject = useCallback(async (kind?: 'starter' | 'empty' | string): Promise<boolean> => {
    if (!(await confirmDiscard('starting a new project'))) return false;
    const start = kind ?? getSettings().newStart;
    if (start !== 'starter' && start !== 'empty' && TEMPLATES.some((t) => t.id === start)) {
      return newFromTemplate(start, false);
    }
    startNew(start === 'empty');
    return true;
  }, [confirmDiscard, newFromTemplate, startNew]);

  return {
    saveProject, saveProjectAs, openProject, loadExample, newProject, newFromTemplate, confirmDiscard,
    autosave, hasFile,
  };
}
