import type { AudioSource, Track } from './schema.js';

/**
 * Choosing an encoding.
 *
 * `canPlayType` returns "probably", "maybe" or "". A "maybe" is the browser
 * saying it recognises the container but has not been told the codec, so it is
 * accepted only when nothing answered "probably". Outside a browser — in a
 * test, or in the publish step — the first source wins, which is why the
 * catalogue stores them best first.
 */
export function pickSource(
  track: Track,
  canPlayType?: (type: string) => CanPlayTypeResult,
): AudioSource {
  const sources = track.sources;
  const first = sources[0];
  if (!first) throw new Error(`track ${track.id} has no audio sources`);
  if (!canPlayType) return first;

  let maybe: AudioSource | null = null;
  for (const source of sources) {
    const verdict = canPlayType(source.mimeType);
    if (verdict === 'probably') return source;
    if (verdict === 'maybe' && !maybe) maybe = source;
  }
  return maybe ?? first;
}

export type CanPlayTypeResult = 'probably' | 'maybe' | '';

/** Total bytes of the encoding this device would actually download. */
export function sizeFor(
  tracks: Track[],
  canPlayType?: (type: string) => CanPlayTypeResult,
): number {
  return tracks.reduce((sum, track) => sum + pickSource(track, canPlayType).bytes, 0);
}
