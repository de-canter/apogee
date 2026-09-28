import '@testing-library/jest-dom/vitest';

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
