import { pickSource, sizeFor, type Track } from '@refrain/catalogue';
import { assetUrl, canPlayType } from './catalogue.js';

/**
 * Offline downloads.
 *
 * The app writes audio into a named Cache Storage bucket and the service
 * worker serves from it. Downloads are explicit — a listener chooses a book,
 * a style and a voice — because the alternative, caching whatever was played,
 * fills a phone quietly and is impossible to reason about.
 */

export const AUDIO_CACHE = 'refrain-audio-v1';

/** Refuse to grow past this, so a mistake cannot fill a device. */
export const CACHE_LIMIT_BYTES = 400 * 1024 * 1024;

export interface DownloadProgress {
  done: number;
  total: number;
  bytes: number;
}

export function offlineSupported(): boolean {
  return typeof caches !== 'undefined';
}

export async function cachedPaths(): Promise<Set<string>> {
  if (!offlineSupported()) return new Set();
  const cache = await caches.open(AUDIO_CACHE);
  const keys = await cache.keys();
  return new Set(keys.map((request) => new URL(request.url).pathname));
}

/** The URL this device would fetch for a track: one encoding, not all of them. */
export function trackUrl(track: Track): string {
  return assetUrl(pickSource(track, canPlayType).path);
}

/** Bytes this device would actually download for these tracks. */
export function downloadSize(tracks: Track[]): number {
  return sizeFor(tracks, canPlayType);
}

export async function isDownloaded(tracks: Track[]): Promise<boolean> {
  if (tracks.length === 0) return false;
  const paths = await cachedPaths();
  return tracks.every((track) => paths.has(new URL(trackUrl(track), location.href).pathname));
}

export class CacheLimitError extends Error {
  constructor(bytes: number) {
    super(
      `That download is ${(bytes / 1024 / 1024).toFixed(0)} MB, past the ${(CACHE_LIMIT_BYTES / 1024 / 1024).toFixed(0)} MB Refrain keeps on a device. Remove another download first.`,
    );
  }
}

export async function downloadTracks(
  tracks: Track[],
  onProgress?: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<DownloadProgress> {
  if (!offlineSupported()) throw new Error('This browser cannot store downloads.');
  const already = await cachedBytes();
  const wanted = downloadSize(tracks);
  if (already + wanted > CACHE_LIMIT_BYTES) throw new CacheLimitError(already + wanted);

  const cache = await caches.open(AUDIO_CACHE);
  const progress: DownloadProgress = { done: 0, total: tracks.length, bytes: 0 };

  for (const track of tracks) {
    if (signal?.aborted) break;
    const source = pickSource(track, canPlayType);
    const url = assetUrl(source.path);
    const existing = await cache.match(url);
    if (!existing) {
      const response = await fetch(url, { credentials: 'omit', signal });
      if (!response.ok) throw new Error(`could not download ${track.id}: ${response.status}`);
      await cache.put(url, response.clone());
    }
    progress.done++;
    progress.bytes += source.bytes;
    onProgress?.({ ...progress });
  }
  return progress;
}

export async function removeTracks(tracks: Track[]): Promise<number> {
  if (!offlineSupported()) return 0;
  const cache = await caches.open(AUDIO_CACHE);
  let removed = 0;
  for (const track of tracks) {
    // Remove every encoding, not only the one this device chose: a listener
    // who switched browsers should still be able to free the space.
    for (const source of track.sources) {
      if (await cache.delete(assetUrl(source.path))) removed++;
    }
  }
  return removed;
}

export async function cachedBytes(): Promise<number> {
  if (!offlineSupported()) return 0;
  const cache = await caches.open(AUDIO_CACHE);
  let total = 0;
  for (const request of await cache.keys()) {
    const response = await cache.match(request);
    if (!response) continue;
    const length = response.headers.get('content-length');
    if (length) {
      total += Number.parseInt(length, 10) || 0;
      continue;
    }
    total += (await response.clone().arrayBuffer()).byteLength;
  }
  return total;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
