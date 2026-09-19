import {
  CatalogueSchema,
  CatalogueIndexSchema,
  type Catalogue,
  type CatalogueIndex,
  type Chunk,
  type Corpus,
  type Preset,
  type Style,
  type Track,
  type Voice,
} from './schema.js';
import { hashValue } from './hash.js';

export interface CatalogueInput {
  corpus: Corpus;
  styles: Style[];
  voices: Voice[];
  presets: Preset[];
  chunks: Chunk[];
  /** Any status; only `published` tracks are carried into the catalogue. */
  tracks: Track[];
  generatedAt: string;
}

export class CatalogueError extends Error {}

/**
 * Build a catalogue from studio records.
 *
 * Refuses to emit anything inconsistent: a published track whose chunk or
 * preset is missing, a preset pointing at an unknown style or voice, a chunk
 * in a book the corpus does not declare. CI runs this, so a broken publish
 * fails the build instead of reaching the CDN (SEC-2).
 */
export async function buildCatalogue(input: CatalogueInput): Promise<Catalogue> {
  const styleIds = new Set(input.styles.map((s) => s.id));
  const voiceIds = new Set(input.voices.map((v) => v.id));
  const bookIds = new Set(input.corpus.books.map((b) => b.id));
  const chunkById = new Map(input.chunks.map((c) => [c.id, c]));
  const presetById = new Map(input.presets.map((p) => [p.id, p]));

  for (const preset of input.presets) {
    if (!styleIds.has(preset.styleId)) {
      throw new CatalogueError(`preset ${preset.id} names unknown style ${preset.styleId}`);
    }
    if (!voiceIds.has(preset.voiceId)) {
      throw new CatalogueError(`preset ${preset.id} names unknown voice ${preset.voiceId}`);
    }
  }
  for (const chunk of input.chunks) {
    if (chunk.corpusId !== input.corpus.id) {
      throw new CatalogueError(`chunk ${chunk.id} belongs to corpus ${chunk.corpusId}`);
    }
    if (!bookIds.has(chunk.bookId)) {
      throw new CatalogueError(`chunk ${chunk.id} names unknown book ${chunk.bookId}`);
    }
  }

  const published: Track[] = [];
  const seen = new Set<string>();
  for (const track of input.tracks) {
    if (track.status !== 'published') continue;
    const chunk = chunkById.get(track.chunkId);
    if (!chunk) throw new CatalogueError(`track ${track.id} names unknown chunk ${track.chunkId}`);
    const preset = presetById.get(track.presetId);
    if (!preset) {
      throw new CatalogueError(`track ${track.id} names unknown preset ${track.presetId}`);
    }
    if (seen.has(track.id)) throw new CatalogueError(`duplicate track id ${track.id}`);
    for (const span of track.alignment) {
      if (span.end < span.start) {
        throw new CatalogueError(`track ${track.id} has a span that ends before it starts`);
      }
      if (span.lineIndex >= chunk.lines.length) {
        throw new CatalogueError(`track ${track.id} aligns line ${span.lineIndex}, out of range`);
      }
    }
    seen.add(track.id);
    published.push(track);
  }

  // Only chunks with at least one published track are worth listing: the app
  // never shows a chunk it cannot play.
  const playableChunkIds = new Set(published.map((t) => t.chunkId));
  const chunks = input.chunks
    .filter((c) => playableChunkIds.has(c.id))
    .sort((a, b) => a.bookId.localeCompare(b.bookId) || a.number - b.number);

  if (chunks.length === 0) throw new CatalogueError('no chunk has a published track');

  const usedBookIds = new Set(chunks.map((c) => c.bookId));
  const corpus: Corpus = {
    ...input.corpus,
    books: input.corpus.books
      .filter((b) => usedBookIds.has(b.id))
      .sort((a, b) => a.order - b.order),
  };

  const body = {
    schemaVersion: 1 as const,
    corpus,
    styles: [...input.styles].sort((a, b) => a.id.localeCompare(b.id)),
    voices: [...input.voices].sort((a, b) => a.id.localeCompare(b.id)),
    presets: [...input.presets].sort((a, b) => a.id.localeCompare(b.id)),
    chunks,
    tracks: published.sort((a, b) => a.id.localeCompare(b.id)) as Catalogue['tracks'],
    generatedAt: input.generatedAt,
  };

  const contentHash = await hashValue(body);
  return CatalogueSchema.parse({ ...body, contentHash });
}

/** Recompute the hash and compare. The app calls this on every load (SEC-10). */
export async function verifyCatalogue(catalogue: Catalogue): Promise<boolean> {
  const { contentHash, ...body } = catalogue;
  return (await hashValue(body)) === contentHash;
}

export function buildIndex(
  catalogues: Array<{ catalogue: Catalogue; path: string }>,
  generatedAt: string,
): CatalogueIndex {
  return CatalogueIndexSchema.parse({
    schemaVersion: 1,
    generatedAt,
    corpora: catalogues.map(({ catalogue, path }) => ({
      id: catalogue.corpus.id,
      title: catalogue.corpus.title,
      author: catalogue.corpus.author,
      path,
      trackCount: catalogue.tracks.length,
      chunkCount: catalogue.chunks.length,
    })),
  });
}
