import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// @testing-library/react's automatic per-test cleanup only self-registers when it finds a
// global `afterEach` (Jest-style). This project runs Vitest without `test.globals`, so without
// this, `render()` output from earlier tests (and earlier renders in the same test) stays
// mounted to `document.body` and leaks into later queries bound to it (e.g. `screen.*`).
afterEach(() => {
  cleanup();
});

// jsdom does not implement ResizeObserver. The MCP Apps SDK's App.connect() calls
// setupSizeChangedNotifications(), which observes document.body for size changes to
// report to the host — harmless to no-op in tests, which never assert on that signal.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub;
}
