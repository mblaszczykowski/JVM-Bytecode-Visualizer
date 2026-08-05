import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { observeUnhandledFailures } from './services/telemetry';
import './index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('No #root element — check index.html.');
}

// Installed before the first render: an error thrown while mounting is exactly the kind no
// error boundary sees. A no-op unless this build was given a telemetry endpoint.
observeUnhandledFailures();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
