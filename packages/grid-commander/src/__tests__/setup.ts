import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Testing Library only auto-cleans under `globals: true`; this suite runs without globals.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Node 26 defines a `localStorage` global that is unusable without --localstorage-file and shadows
// jsdom's; give tests a real in-memory Storage so `window.localStorage` behaves like a browser's.
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  removeItem(k: string) { this.map.delete(k); }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
}
try {
  if (typeof globalThis.localStorage?.getItem !== 'function') {
    Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true });
  }
} catch {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true });
}
