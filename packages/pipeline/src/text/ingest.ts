import fs from 'node:fs';
import path from 'node:path';
import { slugify, type Chunk, type Corpus } from '@refrain/catalogue';

/**
 * Ingest.
 *
 * A corpus is a directory: `corpus.json` describing the text and its rights,
 * and one plain-text file per chunk under `source/`. Each file starts with a
 * title line, then a blank line, then the text. Nothing clever — the point is
 * that a human can see exactly what went in, and that the ingest step refuses
 * anything whose rights are not written down.
 *
 * File names carry two things: the book, before `--`, and the reading order,
 * as a leading number. `innocence--03-the-lamb.txt` is the third poem of
 * Songs of Innocence. Reading order comes from the name rather than the
 * alphabet because a poet's order is not alphabetical, and ids come from the
 * title rather than the name so that reordering a corpus does not break every
 * link into it.
 */

export interface CorpusManifest {
  corpus: Omit<Corpus, 'books'> & { books: Corpus['books'] };
  /** Maps a source file prefix to the book it belongs to. */
  bookOf?: Record<string, string>;
  defaultBookId?: string;
}

export class IngestError extends Error {}

export function readManifest(corpusDir: string): CorpusManifest {
  const file = path.join(corpusDir, 'corpus.json');
  if (!fs.existsSync(file)) throw new IngestError(`no corpus.json in ${corpusDir}`);
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as CorpusManifest;
  const licence = manifest.corpus?.licence;
  if (!licence?.id || !licence?.name) {
    throw new IngestError(`${file}: a corpus needs a licence before it can be ingested`);
  }
  if (!manifest.corpus.sourceUrl) {
    throw new IngestError(`${file}: a corpus needs a sourceUrl recording where the text came from`);
  }
  return manifest;
}

export interface ParsedSource {
  title: string;
  lines: string[];
}

/** Parse one source file: title line, blank line, then the text. */
export function parseSource(raw: string, file: string): ParsedSource {
  // Escaped rather than literal: a byte-order mark in source is invisible and
  // survives a copy-paste into somewhere it breaks something.
  const normalised = raw.replace(/\r\n?/g, '\n').replace(/\uFEFF/g, '');
  const [head, ...rest] = normalised.split(/\n\s*\n/);
  const title = (head ?? '').trim();
  if (!title) throw new IngestError(`${file}: the first line must be the title`);
  if (title.includes('\n')) throw new IngestError(`${file}: the title must be a single line`);
  const body = rest.join('\n\n');
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) throw new IngestError(`${file}: no text after the title`);
  return { title, lines };
}

export interface IngestResult {
  corpus: Corpus;
  chunks: Chunk[];
}

export function ingestCorpus(corpusDir: string): IngestResult {
  const manifest = readManifest(corpusDir);
  const sourceDir = path.join(corpusDir, 'source');
  if (!fs.existsSync(sourceDir)) throw new IngestError(`no source/ directory in ${corpusDir}`);

  const files = fs
    .readdirSync(sourceDir)
    .filter((f) => f.endsWith('.txt'))
    .sort();
  if (files.length === 0) throw new IngestError(`no .txt files in ${sourceDir}`);

  const bookIds = new Set(manifest.corpus.books.map((b) => b.id));
  const chunks: Chunk[] = [];
  const seenNumbers = new Map<string, Set<number>>();

  for (const file of files) {
    const raw = fs.readFileSync(path.join(sourceDir, file), 'utf8');
    const { title, lines } = parseSource(raw, file);
    const bookId = bookFor(file, manifest);
    if (!bookIds.has(bookId)) {
      throw new IngestError(`${file}: book ${bookId} is not declared in corpus.json`);
    }
    const number = numberFor(file, bookId, seenNumbers);
    const id = slugify(title);
    if (chunks.some((c) => c.id === id)) {
      throw new IngestError(`${file}: two chunks slugify to ${id}; give one a distinct title`);
    }
    chunks.push({ id, corpusId: manifest.corpus.id, bookId, number, title, lines });
  }

  return { corpus: manifest.corpus, chunks };
}

/**
 * Reading order from the file name, with the alphabet as a fallback.
 *
 * A duplicate number is an error rather than a silent reshuffle: two poems
 * claiming to be third means someone renamed one and forgot the other.
 */
function numberFor(file: string, bookId: string, seen: Map<string, Set<number>>): number {
  const used = seen.get(bookId) ?? new Set<number>();
  seen.set(bookId, used);
  const stem = file.replace(/\.txt$/, '');
  const afterBook = stem.includes('--') ? stem.slice(stem.indexOf('--') + 2) : stem;
  const match = /^(\d+)[-_]/.exec(afterBook);
  if (match) {
    const number = Number.parseInt(match[1]!, 10);
    if (number < 1) throw new IngestError(`${file}: reading order starts at 1`);
    if (used.has(number)) {
      throw new IngestError(`${file}: another file in ${bookId} is already number ${number}`);
    }
    used.add(number);
    return number;
  }
  let next = 1;
  while (used.has(next)) next++;
  used.add(next);
  return next;
}

function bookFor(file: string, manifest: CorpusManifest): string {
  // `innocence--the-lamb.txt` puts the book in the filename; a mapping or a
  // default covers collections that do not.
  const prefix = file.includes('--') ? file.slice(0, file.indexOf('--')) : undefined;
  const mapped = prefix ? (manifest.bookOf?.[prefix] ?? prefix) : undefined;
  const bookId = mapped ?? manifest.defaultBookId ?? manifest.corpus.books[0]?.id;
  if (!bookId) throw new IngestError(`${file}: cannot decide which book this belongs to`);
  return bookId;
}
