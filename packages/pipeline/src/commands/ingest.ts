import fs from 'node:fs';
import path from 'node:path';
import { CorpusSchema, ChunkSchema, PresetSchema, StyleSchema, VoiceSchema } from '@refrain/catalogue';
import type { Preset, Style, Voice } from '@refrain/catalogue';
import { ingestCorpus } from '../text/ingest.js';
import { prepareLyrics } from '../text/lyricprep.js';
import { resolvePaths } from '../paths.js';
import { JsonStore, upsert } from '../store.js';

export interface IngestOptions {
  corpus?: string;
  root?: string;
}

/**
 * Ingest every corpus under `content/corpora`, plus the render presets.
 *
 * Runs the lyric-prep gate at ingest time rather than at render time: if prep
 * would change a word, the corpus does not enter the pipeline at all.
 */
export async function ingest(options: IngestOptions = {}): Promise<string> {
  const paths = resolvePaths(options.root);
  const store = new JsonStore(paths.store);
  const corporaDir = path.join(paths.content, 'corpora');
  if (!fs.existsSync(corporaDir)) throw new Error(`no corpora directory at ${corporaDir}`);

  const dirs = fs
    .readdirSync(corporaDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => !options.corpus || name === options.corpus)
    .sort();
  if (dirs.length === 0) throw new Error('no corpus matched');

  const { styles, voices, presets } = readPresets(paths.content);
  const lines: string[] = [];

  store.update((records) => {
    for (const style of styles) upsert(records.styles, StyleSchema.parse(style));
    for (const voice of voices) upsert(records.voices, VoiceSchema.parse(voice));
    for (const preset of presets) upsert(records.presets, PresetSchema.parse(preset));

    for (const dir of dirs) {
      const { corpus, chunks } = ingestCorpus(path.join(corporaDir, dir));
      upsert(records.corpora, CorpusSchema.parse(corpus));
      for (const chunk of chunks) {
        // The gate: prep may re-break lines, never re-word them.
        prepareLyrics(chunk.lines);
        upsert(records.chunks, ChunkSchema.parse(chunk));
      }
      lines.push(`${corpus.id}: ${chunks.length} chunks from ${dir}`);
    }
  });

  lines.push(
    `presets: ${presets.length} (${styles.length} styles × ${voices.length} voices)`,
  );
  return lines.join('\n');
}

interface PresetFile {
  styles: Style[];
  voices: Voice[];
  presets: Preset[];
}

function readPresets(contentDir: string): PresetFile {
  const file = path.join(contentDir, 'presets.json');
  if (!fs.existsSync(file)) throw new Error(`no presets.json at ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as PresetFile;
}
