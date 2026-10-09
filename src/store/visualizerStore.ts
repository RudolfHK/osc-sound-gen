import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch } from 'react';
import { DEFAULT_VISUALIZER, type VisualizerSettings } from '../visualizer/spectrum';

// ─── State ────────────────────────────────────────────────────────────────────

export interface VisualizerState extends VisualizerSettings {
  /** Off by default — the analyser tap and redraw loop cost real CPU. */
  enabled: boolean;
  /** Show the settings row under the canvas. */
  showControls: boolean;
}

export type VisualizerAction =
  | { type: 'VIZ_ENABLE'; enabled: boolean }
  | { type: 'VIZ_TOGGLE_CONTROLS' }
  | { type: 'VIZ_SET'; patch: Partial<VisualizerSettings> }
  | { type: 'VIZ_RESET' };

const INITIAL: VisualizerState = {
  ...DEFAULT_VISUALIZER,
  enabled: false,
  showControls: true,
};

export function visualizerReducer(
  state: VisualizerState,
  action: VisualizerAction,
): VisualizerState {
  switch (action.type) {
    case 'VIZ_ENABLE':
      return { ...state, enabled: action.enabled };
    case 'VIZ_TOGGLE_CONTROLS':
      return { ...state, showControls: !state.showControls };
    case 'VIZ_SET':
      return { ...state, ...action.patch };
    case 'VIZ_RESET':
      return { ...state, ...DEFAULT_VISUALIZER };
    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface VisualizerCtx {
  state: VisualizerState;
  dispatch: Dispatch<VisualizerAction>;
}

export const VisualizerContext = createContext<VisualizerCtx | null>(null);

export function useVisualizerStore(): VisualizerCtx {
  const ctx = useContext(VisualizerContext);
  if (!ctx) throw new Error('useVisualizerStore must be inside VisualizerContext.Provider');
  return ctx;
}

const LS_KEY = 'osc-visualizer-state';

export function useVisualizerReducer(): VisualizerCtx {
  const [state, dispatch] = useReducer(visualizerReducer, INITIAL, (init) => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as VisualizerState;
        // Customization persists; the on/off state deliberately does not, so a
        // reload never silently costs CPU.
        return { ...init, ...parsed, enabled: false };
      }
    } catch (_) { /* corrupt or missing */ }
    return init;
  });

  useEffect(() => {
    const id = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (_) { /* quota */ }
    }, 400);
    return () => clearTimeout(id);
  }, [state]);

  return useMemo(() => ({ state, dispatch }), [state]);
}
