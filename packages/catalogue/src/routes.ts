import type { Catalogue } from './schema.js';
import { isId } from './ids.js';

/**
 * Route handling — the SEC-1 boundary.
 *
 * `#/{corpus}/{voice}/{style}/{book}/{chunk}`
 *
 * Nothing taken from the URL is ever rendered. Segments are shape-checked,
 * then resolved to records that already exist in the validated catalogue; the
 * app renders those records. A URL that names something not in the catalogue
 * resolves to `null` and the app shows its not-found view.
 */

export interface Route {
  corpusId: string;
  voiceId: string;
  styleId: string;
  bookId: string;
  chunkId: string;
}

export interface ResolvedRoute extends Route {
  chunk: Catalogue['chunks'][number];
  preset: Catalogue['presets'][number];
  track: Catalogue['tracks'][number];
  book: Catalogue['corpus']['books'][number];
}

const MAX_HASH_LENGTH = 512;

/** Parse a location hash into segment ids. Shape only: no catalogue needed. */
export function parseRoute(hash: string): Route | null {
  if (typeof hash !== 'string' || hash.length > MAX_HASH_LENGTH) return null;
  const withoutHash = hash.startsWith('#') ? hash.slice(1) : hash;
  // Strip any query or nested fragment before splitting.
  const path = withoutHash.split('?')[0]!.split('#')[0]!;
  const segments = path.split('/').filter((s) => s.length > 0);
  if (segments.length !== 5) return null;
  const [corpusId, voiceId, styleId, bookId, chunkId] = segments as [
    string,
    string,
    string,
    string,
    string,
  ];
  let decoded: string[];
  try {
    decoded = [corpusId, voiceId, styleId, bookId, chunkId].map((s) => decodeURIComponent(s));
  } catch {
    return null;
  }
  if (!decoded.every(isId)) return null;
  const [c, v, s, b, k] = decoded as [string, string, string, string, string];
  return { corpusId: c, voiceId: v, styleId: s, bookId: b, chunkId: k };
}

/** Resolve a parsed route against a catalogue. Returns null if anything is missing. */
export function resolveRoute(catalogue: Catalogue, route: Route): ResolvedRoute | null {
  if (catalogue.corpus.id !== route.corpusId) return null;
  const book = catalogue.corpus.books.find((b) => b.id === route.bookId);
  if (!book) return null;
  const chunk = catalogue.chunks.find((c) => c.id === route.chunkId && c.bookId === book.id);
  if (!chunk) return null;
  const preset = catalogue.presets.find(
    (p) => p.styleId === route.styleId && p.voiceId === route.voiceId,
  );
  if (!preset) return null;
  const track = catalogue.tracks.find((t) => t.chunkId === chunk.id && t.presetId === preset.id);
  if (!track) return null;
  return { ...route, book, chunk, preset, track };
}

export function parseAndResolve(catalogue: Catalogue, hash: string): ResolvedRoute | null {
  const route = parseRoute(hash);
  return route ? resolveRoute(catalogue, route) : null;
}

/** Build a hash route. The only place the app composes a URL. */
export function routeToHash(route: Route): string {
  return `#/${route.corpusId}/${route.voiceId}/${route.styleId}/${route.bookId}/${route.chunkId}`;
}

/**
 * The route for a chunk under a chosen style and voice, falling back to any
 * preset that actually has a published track for it.
 */
export function routeForChunk(
  catalogue: Catalogue,
  chunkId: string,
  prefer: { styleId?: string; voiceId?: string } = {},
): Route | null {
  const chunk = catalogue.chunks.find((c) => c.id === chunkId);
  if (!chunk) return null;
  const tracks = catalogue.tracks.filter((t) => t.chunkId === chunkId);
  if (tracks.length === 0) return null;
  const presetsById = new Map(catalogue.presets.map((p) => [p.id, p]));
  const scored = tracks
    .map((t) => presetsById.get(t.presetId))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .sort((a, b) => score(b, prefer) - score(a, prefer));
  const preset = scored[0];
  if (!preset) return null;
  return {
    corpusId: catalogue.corpus.id,
    voiceId: preset.voiceId,
    styleId: preset.styleId,
    bookId: chunk.bookId,
    chunkId: chunk.id,
  };
}

function score(
  preset: Catalogue['presets'][number],
  prefer: { styleId?: string; voiceId?: string },
): number {
  return (
    (prefer.styleId && preset.styleId === prefer.styleId ? 2 : 0) +
    (prefer.voiceId && preset.voiceId === prefer.voiceId ? 1 : 0)
  );
}
