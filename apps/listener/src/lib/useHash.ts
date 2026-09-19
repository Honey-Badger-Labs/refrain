import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function getSnapshot(): string {
  return window.location.hash || '#/';
}

/** The current location hash, as a React value. */
export function useHash(): string {
  return useSyncExternalStore(subscribe, getSnapshot, () => '#/');
}
