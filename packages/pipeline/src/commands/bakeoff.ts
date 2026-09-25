import fs from 'node:fs';
import path from 'node:path';
import { encodeWav, peak } from '../audio/wav.js';
import { ensureDir, resolvePaths } from '../paths.js';
import { JsonStore } from '../store.js';
import { prepareLyrics } from '../text/lyricprep.js';
import { getAdapter } from '../render/types.js';
import { loadProviders, registerProviders } from '../render/providers.js';
import { runChecks, type CheckReport } from '../checks/autochecks.js';
import {
  bestAvailableTranscriber,
  getTranscriber,
  whisperUnavailableReason,
  type Transcriber,
} from '../checks/transcribe.js';

/**
 * The bake-off.
 *
 * The one decision this project cannot make without spending money: does any
 * available music model sing the words accurately enough that a human listen
 * is a confirmation rather than an investigation? Thirty hours of review sit
 * downstream of that answer, so it is worth buying properly and once.
 *
 * Three things make this safe to run. Nothing touches the main store — a
 * bake-off is an experiment, not a publish. Every run has a hard budget and
 * stops rather than exceeding it. And `--dry-run` proves the configs and the
 * prompts are right before a cent is spent, which is where afternoons usually
 * go.
 */

export interface BakeoffOptions {
  root?: string;
  /** Provider names to compare. Defaults to every configured provider. */
  providers?: string[];
  /** Chunk ids to render. Defaults to a spread chosen by the corpus. */
  chunks?: string[];
  /** Renders per chunk per provider, for a look at variance. */
  runs?: number;
  seed?: number;
  /** Hard ceiling in US dollars. The run stops rather than passing it. */
  budgetUsd?: number;
  transcriber?: string;
  /** Spend money on renders nobody can score. Deliberate, and off by default. */
  allowUnscored?: boolean;
  styleId?: string;
  voiceId?: string;
  dryRun?: boolean;
  onProgress?: (message: string) => void;
}

interface Attempt {
  provider: string;
  chunkId: string;
  chunkTitle: string;
  run: number;
  ok: boolean;
  error?: string;
  seconds?: number;
  renderSeconds?: number;
  wordAccuracy?: number;
  report?: CheckReport;
  costUsd: number;
  audioPath?: string;
}

export async function bakeoff(options: BakeoffOptions = {}): Promise<string> {
  const paths = resolvePaths(options.root);
  const progress = options.onProgress ?? (() => {});
  const records = new JsonStore(paths.store).read();
  if (records.chunks.length === 0) throw new Error('no chunks; run `refrain ingest` first');

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = ensureDir(path.join(paths.work, 'bakeoff', runId));
  const available = registerProviders(options.root, path.join(outDir, 'tmp'));
  if (available.length === 0) {
    throw new Error(
      `no provider configs in ${path.relative(paths.root, path.join(paths.content, 'providers'))}. Copy polling-api.example.json and fill it in.`,
    );
  }

  const chosen = options.providers?.length
    ? available.filter((p) => options.providers!.includes(p.config.name))
    : available;
  if (chosen.length === 0) {
    throw new Error(
      `none of those providers are configured. Available: ${available.map((p) => p.config.name).join(', ')}`,
    );
  }

  const chunks = pickChunks(records.chunks, options.chunks);
  const runs = Math.max(1, options.runs ?? 1);
  const seed = options.seed ?? 1;
  const budget = options.budgetUsd ?? 15;

  const estimate = chosen.reduce(
    (sum, p) => sum + p.config.costPerRenderUsd * chunks.length * runs,
    0,
  );

  progress(
    `${chosen.length} provider(s) × ${chunks.length} chunk(s) × ${runs} run(s) = ${chosen.length * chunks.length * runs} renders, about $${estimate.toFixed(2)}`,
  );

  const notReady = chosen.filter((p) => !p.ready);
  for (const provider of notReady) {
    progress(`${provider.config.name}: ${provider.config.apiKeyEnv} is not set`);
  }
  const noTerms = chosen.filter((p) => !p.config.modelTerms.commercialUse);
  for (const provider of noTerms) {
    progress(
      `${provider.config.name}: modelTerms.commercialUse is false. Confirm the terms before this output goes anywhere public.`,
    );
  }

  if (options.dryRun) {
    const style = options.styleId ?? records.presets[0]?.styleId ?? 'hymn';
    const voice = options.voiceId ?? records.presets[0]?.voiceId ?? 'alto';
    const lines = [
      '',
      'Dry run: nothing was sent and nothing was spent.',
      `Would render ${chunks.map((c) => c.title).join(', ')} as ${style} · ${voice}.`,
      `Estimated cost $${estimate.toFixed(2)} against a $${budget.toFixed(2)} budget.`,
      notReady.length ? `Missing keys: ${notReady.map((p) => p.config.apiKeyEnv).join(', ')}` : 'All keys present.',
      '',
      'The prompt the first provider would send:',
      '',
      previewPrompt(chosen[0]!.config.promptTemplate, chunks[0]!.title, style, voice, chunks[0]!.lines),
    ];
    return lines.join('\n');
  }

  if (estimate > budget) {
    throw new Error(
      `that run would cost about $${estimate.toFixed(2)}, over the $${budget.toFixed(2)} budget. Raise --budget deliberately, or cut --runs or --chunks.`,
    );
  }

  const transcriber = options.transcriber
    ? getTranscriber(options.transcriber)
    : await bestAvailableTranscriber();
  const transcriberReady = await transcriber.available();
  if (!transcriberReady || transcriber.name === 'none') {
    // A bake-off with no transcriber bills for audio and answers nothing: the
    // question it exists to settle is word accuracy. Warning and charging on
    // is the same mistake as a check that reports `pass` when it could not
    // run, so this refuses instead. --allow-unscored is there for the case
    // where the audio itself is the point.
    if (!options.allowUnscored) {
      // "Install whisper" is unhelpful to someone who just did; say which
      // whisper answered and what it still needs.
      const diagnosis = await whisperUnavailableReason();
      throw new Error(
        `no transcriber is available, so word accuracy — the number this bake-off exists to produce — cannot be measured, and the renders would cost money without answering anything. Install whisper (whisper-cli or whisper on PATH), or set REFRAIN_ASR_URL and REFRAIN_ASR_KEY. Pass --allow-unscored to render anyway.${diagnosis ? `\n\n${diagnosis}` : ''}`,
      );
    }
    progress(
      'No transcriber is available, so word accuracy will not be measured. Continuing because --allow-unscored was passed.',
    );
  }

  const style = options.styleId ?? records.presets[0]?.styleId ?? 'hymn';
  const voice = options.voiceId ?? records.presets[0]?.voiceId ?? 'alto';

  const attempts: Attempt[] = [];
  let spent = 0;

  for (const provider of chosen) {
    if (!provider.ready) {
      progress(`skipping ${provider.config.name}: no key`);
      continue;
    }
    for (const chunk of chunks) {
      for (let run = 1; run <= runs; run++) {
        if (spent + provider.config.costPerRenderUsd > budget) {
          progress(`stopping: the next render would pass the $${budget.toFixed(2)} budget`);
          return report(outDir, attempts, spent, transcriber, paths.root);
        }

        const label = `${provider.config.name} ${chunk.id} run ${run}`;
        const started = Date.now();
        const attempt: Attempt = {
          provider: provider.config.name,
          chunkId: chunk.id,
          chunkTitle: chunk.title,
          run,
          ok: false,
          costUsd: provider.config.costPerRenderUsd,
        };

        try {
          const lines = prepareLyrics(chunk.lines);
          const result = await getAdapter(provider.config.name).render({
            chunk,
            preset: {
              id: `${style}-${voice}`,
              mode: 'sung',
              styleId: style,
              voiceId: voice,
              adapter: provider.config.name,
              params: {},
            },
            lines,
            seed: seed + run - 1,
            sampleRate: 44100,
          });
          spent += provider.config.costPerRenderUsd;
          attempt.renderSeconds = (Date.now() - started) / 1000;

          const audioPath = path.join(outDir, `${provider.config.name}--${chunk.id}--${run}.wav`);
          fs.writeFileSync(
            audioPath,
            encodeWav(result.samples, { sampleRate: result.sampleRate }),
          );
          attempt.audioPath = path.relative(paths.root, audioPath);
          attempt.seconds = result.samples.length / result.sampleRate;

          const transcript = transcriberReady ? await transcriber.transcribe(audioPath) : null;
          if (transcript !== null) {
            fs.writeFileSync(`${audioPath}.txt`, transcript);
          }
          const checks = runChecks({
            samples: result.samples,
            sampleRate: result.sampleRate,
            lines,
            alignment: result.alignment,
            transcript,
          });
          attempt.report = checks;
          if (checks.wordAccuracy !== undefined) attempt.wordAccuracy = checks.wordAccuracy;
          attempt.ok = true;

          progress(
            `ok   ${label} — ${attempt.seconds.toFixed(0)}s audio in ${attempt.renderSeconds.toFixed(0)}s, peak ${peak(result.samples).toFixed(2)}, accuracy ${
              checks.wordAccuracy === undefined ? 'not measured' : `${(checks.wordAccuracy * 100).toFixed(1)}%`
            }`,
          );
        } catch (error) {
          // A failed render usually still costs money, so it counts against
          // the budget unless the provider clearly refused before generating.
          const message = error instanceof Error ? error.message : String(error);
          const refused = /\b(401|403|404|422)\b/.test(message);
          if (!refused) spent += provider.config.costPerRenderUsd;
          attempt.error = message;
          progress(`FAIL ${label} — ${message.slice(0, 200)}`);
        }

        attempts.push(attempt);
      }
    }
  }

  return report(outDir, attempts, spent, transcriber, paths.root);
}

interface Summary {
  provider: string;
  renders: number;
  failures: number;
  meanAccuracy: number | null;
  worstAccuracy: number | null;
  checksPassed: number;
  meanRenderSeconds: number | null;
  costUsd: number;
  costPerUsableUsd: number | null;
}

export function summarise(attempts: Attempt[]): Summary[] {
  const byProvider = new Map<string, Attempt[]>();
  for (const attempt of attempts) {
    const list = byProvider.get(attempt.provider) ?? [];
    list.push(attempt);
    byProvider.set(attempt.provider, list);
  }

  return [...byProvider.entries()].map(([provider, list]) => {
    const ok = list.filter((a) => a.ok);
    const accuracies = ok
      .map((a) => a.wordAccuracy)
      .filter((a): a is number => typeof a === 'number');
    const renderTimes = ok
      .map((a) => a.renderSeconds)
      .filter((s): s is number => typeof s === 'number');
    const usable = ok.filter((a) => a.report?.passed).length;
    const cost = list.reduce((sum, a) => sum + (a.ok || !a.error ? a.costUsd : 0), 0);

    return {
      provider,
      renders: list.length,
      failures: list.length - ok.length,
      meanAccuracy: accuracies.length ? mean(accuracies) : null,
      worstAccuracy: accuracies.length ? Math.min(...accuracies) : null,
      checksPassed: usable,
      meanRenderSeconds: renderTimes.length ? mean(renderTimes) : null,
      costUsd: cost,
      costPerUsableUsd: usable > 0 ? cost / usable : null,
    };
  });
}

function report(
  outDir: string,
  attempts: Attempt[],
  spent: number,
  transcriber: Transcriber,
  root: string,
): string {
  const summaries = summarise(attempts);
  fs.writeFileSync(
    path.join(outDir, 'report.json'),
    `${JSON.stringify({ attempts, summaries, spentUsd: spent, transcriber: transcriber.name }, null, 2)}\n`,
  );

  const lines: string[] = [
    '# Bake-off',
    '',
    `${attempts.length} render(s), about $${spent.toFixed(2)} spent. Transcriber: ${transcriber.name}.`,
    '',
    '| Provider | Renders | Failed | Mean accuracy | Worst | Checks passed | Mean render | Cost | Cost per usable |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const s of summaries) {
    lines.push(
      `| ${s.provider} | ${s.renders} | ${s.failures} | ${pct(s.meanAccuracy)} | ${pct(s.worstAccuracy)} | ${s.checksPassed}/${s.renders} | ${s.meanRenderSeconds === null ? '—' : `${s.meanRenderSeconds.toFixed(0)}s`} | $${s.costUsd.toFixed(2)} | ${s.costPerUsableUsd === null ? '—' : `$${s.costPerUsableUsd.toFixed(2)}`} |`,
    );
  }

  lines.push('', '## What this says', '');
  if (transcriber.name === 'none') {
    lines.push(
      '- **Word accuracy was not measured.** Nothing listened to these renders, so the number this bake-off exists to produce does not exist. Install whisper or set an ASR endpoint and run it again.',
    );
  }
  for (const s of summaries) {
    lines.push(`- **${s.provider}**: ${verdict(s)}`);
  }
  lines.push(
    '',
    '## Then listen',
    '',
    `The audio is in \`${path.relative(root, outDir)}\`, with each transcript beside it. Numbers narrow the field; the last call is whether it is worth hearing twice.`,
    '',
    '_Alignment is not measured here: a music API returns audio, not line timings. That check reports `skipped` until an aligner is wired in._',
  );

  const markdown = `${lines.join('\n')}\n`;
  fs.writeFileSync(path.join(outDir, 'report.md'), markdown);
  return `${markdown}\nWritten to ${path.relative(root, outDir)}`;
}

function verdict(s: Summary): string {
  if (s.failures === s.renders) return 'every render failed — check the config and the key before drawing any conclusion.';
  if (s.meanAccuracy === null) return 'rendered, but accuracy is unmeasured, so this says nothing about whether it sings the words.';
  if (s.meanAccuracy >= 0.98) {
    return `${pct(s.meanAccuracy)} mean accuracy. Good enough to commit to: at ${s.costPerUsableUsd === null ? 'unknown' : `$${s.costPerUsableUsd.toFixed(2)}`} per usable track, 600 tracks is about $${s.costPerUsableUsd === null ? '—' : (s.costPerUsableUsd * 600).toFixed(0)}.`;
  }
  if (s.meanAccuracy >= 0.9) {
    return `${pct(s.meanAccuracy)} mean accuracy — close. One more cycle on the prompt is worth it; two is not.`;
  }
  return `${pct(s.meanAccuracy)} mean accuracy. Not usable for a text-faithful library. Drama mode with multi-voice TTS is the better bet.`;
}

function pickChunks(chunks: ReturnType<JsonStore['read']>['chunks'], wanted?: string[]) {
  if (wanted?.length) {
    const found = chunks.filter((c) => wanted.includes(c.id));
    if (found.length === 0) throw new Error(`no chunk matched ${wanted.join(', ')}`);
    return found;
  }
  // Shortest, longest and one in the middle: the three cases that break
  // differently. A model that handles all three handles the corpus.
  const sorted = [...chunks].sort((a, b) => a.lines.length - b.lines.length);
  const picked = [sorted[0], sorted[Math.floor(sorted.length / 2)], sorted[sorted.length - 1]];
  return [...new Map(picked.filter(Boolean).map((c) => [c!.id, c!])).values()];
}

function previewPrompt(
  template: string | undefined,
  title: string,
  style: string,
  voice: string,
  lines: string[],
): string {
  const text =
    template ??
    'A {{style}} setting of the poem "{{title}}", sung clearly by a single {{voice}} voice. Every word must be sung exactly as written, in order, with no words added, repeated or left out. Lyrics:\n{{lyrics}}';
  return text
    .replace(/\{\{style\}\}/g, style)
    .replace(/\{\{voice\}\}/g, voice)
    .replace(/\{\{title\}\}/g, title)
    .replace(/\{\{lyrics\}\}/g, lines.join('\n'));
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function pct(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

export { loadProviders };
