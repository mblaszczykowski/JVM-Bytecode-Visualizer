import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest jest uruchamiany bez `globals`, więc automatyczne sprzątanie
// Testing Library nie włącza się samo — rejestrujemy je jawnie.
afterEach(() => {
  cleanup();
});
