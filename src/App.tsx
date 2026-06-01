import { AppContext, useAppReducer } from './store/appStore';
import { Layout } from './ui/layout';

export default function App() {
  const store = useAppReducer();
  return (
    <AppContext.Provider value={store}>
      <Layout />
    </AppContext.Provider>
  );
}
