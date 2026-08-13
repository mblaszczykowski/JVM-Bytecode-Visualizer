import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import { resetGlossary } from '../services/views/glossary-store';

afterEach(() => {
  cleanup();
  resetGlossary();
});
