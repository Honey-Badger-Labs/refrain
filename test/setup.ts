/**
 * Shared test setup.
 *
 * jsdom has no `matchMedia`, no `ResizeObserver` and only a stub of the media
 * element API, so the listener's player would throw before a single assertion
 * ran. These shims are deliberately dumb: they make the elements observable
 * from tests without pretending to decode audio.
 */
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }

  if (!('ResizeObserver' in window)) {
    (window as unknown as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  // jsdom implements no scrolling at all, and the synced-text view scrolls the
  // active line into the middle on every change.
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = () => {};
  }

  const proto = window.HTMLMediaElement.prototype;
  if (!('__refrainPatched' in proto)) {
    Object.defineProperty(proto, '__refrainPatched', { value: true });
    proto.play = vi.fn().mockResolvedValue(undefined);
    proto.pause = vi.fn();
    proto.load = vi.fn();
    if (!proto.canPlayType) proto.canPlayType = () => '';
  }
}

afterEach(() => {
  // Vitest is not running with globals, so Testing Library's automatic cleanup
  // does not hook itself up. Without this, every render leaks into the next
  // test and queries start finding two of everything.
  cleanup();
  vi.clearAllMocks();
});
