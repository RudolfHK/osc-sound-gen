import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { applyTheme } from './ui/theme';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { applyUiScale } from './ui/scale';
import { getSettings, subscribeSettings } from './store/settings';

// Before the first paint, so a light-theme user never sees a dark flash
applyTheme();
applyUiScale(getSettings().uiScale);
subscribeSettings(() => applyUiScale(getSettings().uiScale));

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
