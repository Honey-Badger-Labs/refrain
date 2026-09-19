/**
 * Service worker registration.
 *
 * Registered against the app's own base, so a deploy under /refrain/ does not
 * claim the whole github.io origin. Failure is not fatal: without a worker the
 * app still streams, it just cannot be downloaded for offline use.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;

  window.addEventListener('load', () => {
    const base = import.meta.env.BASE_URL || '/';
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch((error: unknown) => {
      console.warn('Refrain works online without a service worker; registration failed:', error);
    });
  });
}
