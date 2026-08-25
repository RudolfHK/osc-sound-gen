import { AppContext, useAppReducer } from './store/appStore';
import { DrumContext, useDrumReducer } from './store/drumStore';
import { InstrumentContext, useInstrumentReducer } from './store/instrumentStore';
import { Layout } from './ui/layout';

export default function App() {
  const store = useAppReducer();
  const drumStore = useDrumReducer();
  const instrumentStore = useInstrumentReducer();
  return (
    <AppContext.Provider value={store}>
      <DrumContext.Provider value={drumStore}>
        <InstrumentContext.Provider value={instrumentStore}>
          <Layout />
        </InstrumentContext.Provider>
      </DrumContext.Provider>
    </AppContext.Provider>
  );
}
