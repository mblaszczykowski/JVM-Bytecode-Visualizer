import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { ErrorBoundary } from './components/chrome/ErrorBoundary';
import { observeUnhandledFailures } from './services/session/telemetry';
import { applyTheme, storedTheme } from './services/session/theme';
import './index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('No #root element. Check index.html.');
}

observeUnhandledFailures();
applyTheme(storedTheme());

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary
      fallback={(error) => (
        <div
          role="alert"
          className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center"
        >
          <p className="text-title font-medium text-fg">The visualizer stopped.</p>
          <p className="max-w-[420px] text-body text-fg-2">
            Reload the page to start again. The browser console has the {error.name} behind it.
          </p>
        </div>
      )}
    >
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
