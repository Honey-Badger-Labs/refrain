import fs from 'node:fs';
import path from 'node:path';
import { hashValue, sha256Hex, trackId, type Track } from '@refrain/catalogue';
import { resolvePaths, ensureDir } from '../paths.js';
import { JsonStore, upsert, upsertProvenance } from '../store.js';
import { prepareLyrics } from '../text/lyricprep.js';
import { encodeWav } from '../audio/wav.js';
import { assertFfmpeg, encode, CODEC_SETTINGS, type Codec } from '../audio/encode.js';
import { getAdapter } from '../render/types.js';
import { runChecks, type CheckReport } from '../checks/autochecks.js';
import { getTranscriber } from '../checks/transcribe.js';

export interface RenderOptions {
  root?: string;
  corpus?: string;
  preset?: string;
  chunk?: string;
  seed?: number;
  force?: boolean;
  transcriber?: string;
  sampleRate?: number;
  /** Delivery formats, best first. Defaults to Opus then AAC. */
  formats?: Codec[];
  onProgress?: (message: string) => void;
}

/**
 * Render the chunk × preset matrix.
 *
 * Every output is a candidate. Candidates live under `work/candidates`, which
 * is gitignored and never served: nothing reaches the public library without
 * passing through review and publish (SEC-6, Principle 3).
 *
 * Re-running is cheap and safe. A track that already has audio and a recorded
 * verdict is skipped unless `--force` is given, so a rejected take can be
 * re-rendered without disturbing approved work.
 */
export async function render(options: RenderOptions = {}): Promise<string> {
  const paths = resolvePaths(options.root);
  const store = new JsonStore(paths.store);
  const records = store.read();
  const progress = options.onProgress ?? (() => {});
  const sampleRate = options.sampleRate ?? 44100;
  const seed = options.seed ?? 1;

  const formats: Codec[] = options.formats ?? ['opus', 'aac'];
  await assertFfmpeg(formats);
  const transcriber = getTranscriber(options.transcriber ?? 'none');
  const transcriberReady = await transcriber.available();
  if (!transcriberReady && transcriber.name !== 'none') {
    progress(`transcriber ${transcriber.name} is not installed; accuracy will be reported as unchecked`);
  }

  const chunks = records.chunks.filter(
    (c) =>
      (!options.corpus || c.corpusId === options.corpus) && (!options.chunk || c.id === options.chunk),
  );
  const presets = records.presets.filter((p) => !options.preset || p.id === options.preset);
  if (chunks.length === 0) throw new Error('no chunk matched; run `refrain ingest` first');
  if (presets.length === 0) throw new Error('no preset matched');

  let rendered = 0;
  let skipped = 0;
  let failed = 0;

  for (const chunk of chunks) {
    for (const preset of presets) {
      const id = trackId(chunk.id, preset.id);
      const existing = records.tracks.find((t) => t.id === id);
      const candidateDir = ensureDir(path.join(paths.candidates, chunk.corpusId));
      const wavPath = path.join(candidateDir, `${id}.wav`);
      const stem = path.join(candidateDir, id);
      const expected = formats.map((codec) => `${stem}.${CODEC_SETTINGS[codec].extension}`);

      if (
        !options.force &&
        existing &&
        existing.status !== 'rejected' &&
        expected.every((file) => fs.existsSync(file))
      ) {
        skipped++;
        continue;
      }

      const lines = prepareLyrics(chunk.lines);
      const adapter = getAdapter(preset.adapter);
      const result = await adapter.render({ chunk, preset, lines, seed, sampleRate });

      fs.writeFileSync(wavPath, encodeWav(result.samples, { sampleRate: result.sampleRate }));
      const encoded = [];
      for (const codec of formats) {
        encoded.push(await encode(wavPath, stem, codec));
      }
      const primary = encoded[0]!;

      // Transcribe the WAV, not a delivery encoding: the check is about what
      // the renderer produced, and lossy compression is not what it is testing.
      const transcript = transcriberReady ? await transcriber.transcribe(wavPath) : null;
      const report = runChecks({
        samples: result.samples,
        sampleRate: result.sampleRate,
        lines,
        alignment: result.alignment,
        transcript,
      });
      fs.writeFileSync(
        path.join(candidateDir, `${id}.checks.json`),
        `${JSON.stringify(report, null, 2)}\n`,
      );

      const sources = [];
      for (const file of encoded) {
        sources.push({
          // A candidate's path points at the private working copy. `publish`
          // rewrites it to the public one; nothing serves this path.
          path: toPosix(path.relative(paths.root, file.path)),
          mimeType: file.mimeType,
          codec: file.codec,
          bitrateKbps: file.bitrateKbps,
          bytes: file.bytes,
          sha256: await sha256Hex(new Uint8Array(fs.readFileSync(file.path))),
        });
      }

      const track: Track = {
        id,
        chunkId: chunk.id,
        presetId: preset.id,
        sources,
        durationSeconds: primary.durationSeconds,
        alignment: result.alignment,
        status: 'candidate',
      };
      const promptHash = await hashValue({
        chunkId: chunk.id,
        presetId: preset.id,
        adapter: preset.adapter,
        params: preset.params,
        promptTemplate: preset.promptTemplate ?? null,
        lines,
      });

      store.update((r) => {
        upsert(r.tracks, track);
        upsertProvenance(r.provenance, {
          trackId: id,
          adapter: adapter.name,
          ...(result.modelId ? { modelId: result.modelId } : {}),
          ...(result.modelVersion ? { modelVersion: result.modelVersion } : {}),
          ...(result.modelTerms ? { modelTerms: result.modelTerms } : {}),
          promptHash,
          seed,
          renderedAt: new Date().toISOString(),
          ...(report.wordAccuracy === undefined ? {} : { wordAccuracy: report.wordAccuracy }),
          notes: summarise(report),
        });
        // Re-rendering clears any earlier verdict: the take being judged has
        // changed, so the approval no longer applies.
        const provenance = r.provenance.find((p) => p.trackId === id);
        if (provenance) {
          delete provenance.verdict;
          delete provenance.reason;
          delete provenance.reviewer;
          delete provenance.reviewedAt;
        }
      });
      // Keep the store fresh for the next iteration's `existing` lookup.
      records.tracks = store.read().tracks;

      rendered++;
      if (!report.passed) failed++;
      progress(
        `${report.passed ? 'ok  ' : 'FAIL'} ${id} ${primary.durationSeconds.toFixed(1)}s ${encoded
          .map((f) => `${f.codec} ${(f.bytes / 1024).toFixed(0)}KB`)
          .join(' / ')}${report.incomplete ? ' (incomplete checks)' : ''}`,
      );
    }
  }

  return [
    `rendered ${rendered}, skipped ${skipped}`,
    failed > 0 ? `${failed} candidate(s) failed an auto check and should not be approved` : null,
    `candidates are in ${path.relative(paths.root, paths.candidates)} and are not served`,
  ]
    .filter(Boolean)
    .join('\n');
}

function summarise(report: CheckReport): string {
  return report.results.map((r) => `${r.id}: ${r.status} — ${r.detail}`).join(' | ').slice(0, 2000);
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}
