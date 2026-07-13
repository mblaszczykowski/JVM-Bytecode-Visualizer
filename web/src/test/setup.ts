import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs without `globals`, so Testing Library's auto-cleanup
// never registers itself — hook it up explicitly.
afterEach(() => {
  cleanup();
});
