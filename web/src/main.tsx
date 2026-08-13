import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { observeUnhandledFailures } from './services/session/telemetry';
import './index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('No #root element. Check index.html.');
}

observeUnhandledFailures();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
