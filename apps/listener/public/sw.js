/**
 * Refrain's service worker.
 *
 * Hand-written rather than generated, because the caching rules here are the
 * app's offline promise and its SEC-10 answer, and both should be readable.
 *
 * Three caches, three different jobs:
 *   shell    the app itself, replaced wholesale on every deploy
 *   data     catalogue JSON, refreshed in the background
 *   audio    tracks the listener explicitly downloaded, never evicted here
 *
 * `__BUILD_ID__` and `__SHELL__` are replaced at build time by the Vite plugin
 * in vite.config.ts, so a new build cannot be served out of an old cache.
 */

const BUILD = '__BUILD_ID__';
const SHELL_CACHE = `refrain-shell-${BUILD}`;
const DATA_CACHE = `refrain-data-${BUILD}`;
const AUDIO_CACHE = 'refrain-audio-v1';
const SHELL_FILES = "__SHELL__";

const SCOPE = new URL(self.registration.scope);

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.all(
        SHELL_FILES.map(async (file) => {
          try {
            await cache.add(new URL(file, SCOPE).toString());
          } catch {
            // One missing asset must not block the whole install; it will be
            // picked up at runtime instead.
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        const ours = name.startsWith('refrain-');
        const current = name === SHELL_CACHE || name === DATA_CACHE || name === AUDIO_CACHE;
        if (ours && !current) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Only ever serve this app's own files. Anything else goes straight to the
  // network untouched.
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;

  if (url.pathname.endsWith('.m4a') || url.pathname.endsWith('.webm')) {
    event.respondWith(cacheFirst(request, AUDIO_CACHE));
    return;
  }
  if (url.pathname.endsWith('.json')) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
});

/**
 * Downloaded audio is served from the cache and never revalidated: published
 * file names carry the audio's content hash, so a changed track is a different
 * URL and a cached one can never be stale.
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    return await fetch(request);
  } catch (error) {
    const fallback = await caches.match(request);
    if (fallback) return fallback;
    throw error;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) void cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (hit) {
    void network;
    return hit;
  }
  const response = await network;
  if (response) return response;
  return new Response('Offline and not downloaded.', {
    status: 504,
    headers: { 'content-type': 'text/plain' },
  });
}

/** Hash routes all resolve to one document, so every navigation gets the shell. */
async function navigationResponse(request) {
  const cache = await caches.open(SHELL_CACHE);
  const indexUrl = new URL('index.html', SCOPE).toString();
  try {
    const response = await fetch(request);
    if (response.ok) void cache.put(indexUrl, response.clone());
    return response;
  } catch {
    const cached = (await cache.match(indexUrl)) ?? (await cache.match(SCOPE.toString()));
    if (cached) return cached;
    return new Response('Refrain is offline and has not been downloaded yet.', {
      status: 503,
      headers: { 'content-type': 'text/plain' },
    });
  }
}
