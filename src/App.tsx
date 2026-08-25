import { AppContext, useAppReducer } from './store/appStore';
import { DrumContext, useDrumReducer } from './store/drumStore';
import { InstrumentContext, useInstrumentReducer } from './store/instrumentStore';
import { EffectsContext, useEffectsReducer } from './store/effectsStore';
import { Layout } from './ui/layout';

export default function App() {
  const store = useAppReducer();
  const drumStore = useDrumReducer();
  const instrumentStore = useInstrumentReducer();
  // Tempo-synced delay needs the sequencer's BPM
  const effectsStore = useEffectsReducer(store.state.sequencer.bpm);

  return (
    <AppContext.Provider value={store}>
      <DrumContext.Provider value={drumStore}>
        <InstrumentContext.Provider value={instrumentStore}>
          <EffectsContext.Provider value={effectsStore}>
            <Layout />
          </EffectsContext.Provider>
        </InstrumentContext.Provider>
      </DrumContext.Provider>
    </AppContext.Provider>
  );
}
