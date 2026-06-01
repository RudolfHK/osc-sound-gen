import { useState, useEffect, useCallback, useRef } from 'react';
import { Layout } from './ui/layout';
import { getAudioEngine } from './engine/audio';
import { DEFAULT_STATE, DEFAULT_ADVANCED } from './engine/oscillator';
import type { OscillatorState, AdvancedSettings } from './engine/oscillator';

export default function App() {
  const [state, setState] = useState<OscillatorState>(DEFAULT_STATE);
  const [advanced, setAdvanced] = useState<AdvancedSettings>(DEFAULT_ADVANCED);

  // Keep a ref so the audio update effect always has the latest values
  const stateRef = useRef(state);
  const advancedRef = useRef(advanced);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { advancedRef.current = advanced; }, [advanced]);

  // Push parameter changes to audio engine when playing
  useEffect(() => {
    if (!state.isPlaying) return;
    getAudioEngine().updateParams(state, advanced);
  }, [state, advanced]);

  const handleStateChange = useCallback((newState: OscillatorState) => {
    setState(newState);
  }, []);

  const handleAdvancedChange = useCallback((newAdv: AdvancedSettings) => {
    setAdvanced(newAdv);
  }, []);

  const handleTogglePlay = useCallback(async () => {
    const engine = getAudioEngine();
    const current = stateRef.current;
    const adv = advancedRef.current;

    if (current.isPlaying) {
      engine.stop();
      setState((s) => ({ ...s, isPlaying: false }));
    } else {
      try {
        await engine.play(current, adv);
        setState((s) => ({ ...s, isPlaying: true }));
      } catch (err) {
        console.error('AudioContext failed to start:', err);
      }
    }
  }, []);

  return (
    <Layout
      state={state}
      advanced={advanced}
      onStateChange={handleStateChange}
      onAdvancedChange={handleAdvancedChange}
      onTogglePlay={handleTogglePlay}
    />
  );
}
