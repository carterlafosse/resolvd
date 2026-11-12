// Test setup: browser APIs that jsdom lacks but Mantine uses, and unmounting after each test.
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// React Testing Library only cleans up automatically when Vitest globals are on; they're off.
afterEach(() => {
  cleanup();
});

// From Mantine's testing guide: jsdom has no matchMedia or ResizeObserver.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserver;

window.HTMLElement.prototype.scrollIntoView = () => {};

// Mantine's autosize Textarea re-measures when web fonts load; jsdom has no document.fonts.
if (!document.fonts) {
  Object.defineProperty(document, 'fonts', {
    value: { addEventListener: () => {}, removeEventListener: () => {} },
  });
}
