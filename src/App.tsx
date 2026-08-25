import { AppContext, useAppReducer } from './store/appStore';
import { DrumContext, useDrumReducer } from './store/drumStore';
import { Layout } from './ui/layout';

export default function App() {
  const store = useAppReducer();
  const drumStore = useDrumReducer();
  return (
    <AppContext.Provider value={store}>
      <DrumContext.Provider value={drumStore}>
        <Layout />
      </DrumContext.Provider>
    </AppContext.Provider>
  );
}
