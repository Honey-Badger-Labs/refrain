import fs from 'node:fs';
import path from 'node:path';
import { buildCatalogue, buildIndex, type Catalogue, type Track } from '@refrain/catalogue';
import { resolvePaths, ensureDir } from '../paths.js';
import { JsonStore } from '../store.js';
import { writeSharePages } from './share.js';

export interface PublishOptions {
  root?: string;
  corpus?: string;
  /** Allow tracks whose only approval came from `auto-approve`. */
  allowAuto?: boolean;
  onProgress?: (message: string) => void;
}

/**
 * Publish.
 *
 * Copies approved audio out of the private candidates area into the app's
 * public library, regenerates each corpus catalogue and the index, and marks
 * the tracks published. This is the only step that moves a byte into
 * public view (SEC-6), and the catalogue is generated here rather than
 * hand-written anywhere (SEC-2).
 *
 * Published file names carry the audio's content hash, which gives three
 * things at once: cache busting, a non-guessable name (SEC-3), and a file that
 * cannot silently change under a cached catalogue (SEC-10).
 */
export async function publish(options: PublishOptions = {}): Promise<string> {
  const paths = resolvePaths(options.root);
  const store = new JsonStore(paths.store);
  const records = store.read();
  const progress = options.onProgress ?? (() => {});

  const corpora = records.corpora.filter((c) => !options.corpus || c.id === options.corpus);
  if (corpora.length === 0) throw new Error('no corpus matched; run `refrain ingest` first');

  const generatedAt = new Date().toISOString();
  const built: Array<{ catalogue: Catalogue; path: string }> = [];
  let copied = 0;
  let refused = 0;

  for (const corpus of corpora) {
    const chunkIds = new Set(
      records.chunks.filter((c) => c.corpusId === corpus.id).map((c) => c.id),
    );
    const approved = records.tracks.filter(
      (t) => chunkIds.has(t.chunkId) && (t.status === 'approved' || t.status === 'published'),
    );

    const publishable: Track[] = [];
    for (const track of approved) {
      const provenance = records.provenance.find((p) => p.trackId === track.id);
      if (!provenance || provenance.verdict !== 'approve') {
        progress(`hold ${track.id}: no recorded approval`);
        refused++;
        continue;
      }
      if (!options.allowAuto && provenance.reviewer?.startsWith('auto:')) {
        progress(`hold ${track.id}: approved by ${provenance.reviewer}, needs a person or --allow-auto`);
        refused++;
        continue;
      }

      // Candidate files are found by convention, not by the path stored on
      // the track: that path is rewritten to the public one on the first
      // publish, and looking it up again would break every republish.
      const candidateFor = (source: { path: string }) =>
        path.join(paths.candidates, corpus.id, `${track.id}${path.extname(source.path)}`);

      const missing = track.sources.filter((source) => !fs.existsSync(candidateFor(source)));
      if (missing.length > 0) {
        progress(
          `hold ${track.id}: candidate audio is missing at ${missing
            .map((m) => path.relative(paths.root, candidateFor(m)))
            .join(', ')}`,
        );
        refused++;
        continue;
      }

      const sources = track.sources.map((source) => {
        const from = candidateFor(source);
        const extension = path.extname(source.path);
        const fingerprint = source.sha256.slice(0, 16);
        const relative = `${corpus.id}/${track.chunkId}/${track.presetId}.${fingerprint}${extension}`;
        const destination = path.join(paths.published, relative);
        ensureDir(path.dirname(destination));
        fs.copyFileSync(from, destination);
        copied++;
        return { ...source, path: `library/${relative}` };
      });

      publishable.push({ ...track, status: 'published', sources });
    }

    if (publishable.length === 0) {
      progress(`${corpus.id}: nothing to publish`);
      continue;
    }

    const catalogue = await buildCatalogue({
      corpus,
      styles: records.styles,
      voices: records.voices,
      presets: records.presets,
      chunks: records.chunks.filter((c) => c.corpusId === corpus.id),
      tracks: publishable,
      generatedAt,
    });

    const cataloguePath = path.join(paths.published, corpus.id, 'catalogue.json');
    ensureDir(path.dirname(cataloguePath));
    fs.writeFileSync(cataloguePath, `${JSON.stringify(catalogue, null, 2)}\n`);
    built.push({ catalogue, path: `library/${corpus.id}/catalogue.json` });
    const shared = writeSharePages(paths.published, catalogue);

    store.update((r) => {
      for (const track of publishable) {
        const existing = r.tracks.find((t) => t.id === track.id);
        if (existing) {
          existing.status = 'published';
          existing.sources = track.sources;
        }
      }
    });

    progress(
      `${corpus.id}: ${publishable.length} tracks, ${shared} share pages, catalogue ${catalogue.contentHash.slice(0, 12)}`,
    );
  }

  if (built.length === 0) throw new Error('nothing was publishable');

  const index = buildIndex(built, generatedAt);
  fs.writeFileSync(
    path.join(paths.published, 'index.json'),
    `${JSON.stringify(index, null, 2)}\n`,
  );

  // Remove published audio that no catalogue references any more, so an old
  // take does not linger on the CDN after a re-render.
  const wanted = new Set(
    built.flatMap(({ catalogue }) => catalogue.tracks.flatMap((t) => t.sources.map((s) => s.path))),
  );
  const removed = pruneOrphans(paths.published, wanted);

  return [
    `published ${copied} file(s) across ${built.length} corpus/corpora`,
    refused > 0 ? `${refused} track(s) held back` : null,
    removed > 0 ? `removed ${removed} orphaned file(s)` : null,
    `library written to ${path.relative(paths.root, paths.published)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

const AUDIO_EXTENSIONS = ['.m4a', '.webm', '.opus', '.ogg', '.mp3'];

function pruneOrphans(publishedRoot: string, wanted: Set<string>): number {
  let removed = 0;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
        continue;
      }
      if (!AUDIO_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
      const relative = `library/${path.relative(publishedRoot, full).split(path.sep).join('/')}`;
      if (!wanted.has(relative)) {
        fs.unlinkSync(full);
        removed++;
      }
    }
  };
  if (fs.existsSync(publishedRoot)) walk(publishedRoot);
  return removed;
}
