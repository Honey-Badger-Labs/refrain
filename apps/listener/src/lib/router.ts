import { parseRoute, type Route } from '@refrain/catalogue';

/**
 * The app's view model of the URL.
 *
 * The listening route is the spec's five-segment shape and is parsed by the
 * catalogue package, which validates it. Everything else is a short, fixed
 * prefix that can never collide with it, because a listening route always has
 * exactly five segments.
 */
export type View =
  | { name: 'home' }
  | { name: 'book'; bookId: string }
  | { name: 'rights' }
  | { name: 'listen'; route: Route }
  | { name: 'unknown'; hash: string };

export function viewFromHash(hash: string): View {
  const route = parseRoute(hash);
  if (route) return { name: 'listen', route };

  const path = (hash.startsWith('#') ? hash.slice(1) : hash).split('?')[0] ?? '';
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 0) return { name: 'home' };
  if (segments.length === 1 && segments[0] === 'rights') return { name: 'rights' };
  if (segments.length === 2 && segments[0] === 'book') {
    const bookId = safeDecode(segments[1]!);
    if (bookId && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(bookId) && bookId.length <= 64) {
      return { name: 'book', bookId };
    }
  }
  return { name: 'unknown', hash };
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export const homeHash = '#/';
export const rightsHash = '#/rights';
export function bookHash(bookId: string): string {
  return `#/book/${bookId}`;
}

export function navigate(hash: string): void {
  if (window.location.hash === hash) return;
  window.location.hash = hash;
}

/** Replace rather than push, for changes the back button should not replay. */
export function replace(hash: string): void {
  const url = new URL(window.location.href);
  url.hash = hash;
  window.history.replaceState(null, '', url.toString());
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
