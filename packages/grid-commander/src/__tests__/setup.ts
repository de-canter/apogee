import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Testing Library only auto-cleans under `globals: true`; this suite runs without globals.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
