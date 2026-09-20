#!/usr/bin/env node
import { parseArgs } from 'node:util';
import type { RejectReason } from '@refrain/catalogue';
import type { Codec } from './audio/encode.js';
import { ingest } from './commands/ingest.js';
import { render } from './commands/render.js';
import { autoApprove, recordVerdict } from './commands/review.js';
import { publish } from './commands/publish.js';
import { verify } from './commands/verify.js';
import { status } from './commands/status.js';
import { bakeoff, loadProviders } from './commands/bakeoff.js';
import { registerProviders } from './render/providers.js';
import { registerAdapter, listAdapters } from './render/types.js';
import { synthAdapter } from './render/synth.js';

registerAdapter(synthAdapter);

const USAGE = `refrain — the Refrain batch pipeline

  refrain ingest   [--corpus <id>]
  refrain render   [--corpus <id>] [--preset <id>] [--chunk <id>] [--seed <n>]
                   [--formats opus,aac]
                   [--transcriber none|whisper-cli] [--force]
  refrain approve  --track <id> --reviewer <name>
  refrain reject   --track <id> --reviewer <name> --reason <wrong-words|bad-audio|style-off|timing-off|other>
  refrain auto-approve [--corpus <id>]      approve everything whose checks passed
  refrain publish  [--corpus <id>] [--allow-auto]
  refrain verify                             check the published library
  refrain status                             where the pilot stands
  refrain pilot                              ingest, render, auto-approve, publish, verify
  refrain bakeoff  [--providers a,b] [--chunks x,y] [--runs 2] [--budget 15]
                   [--style hymn] [--voice alto] [--dry-run] [--allow-unscored]
                   compare music models on word accuracy and cost
  refrain adapters                           list render adapters and providers

Candidates never leave work/candidates until publish copies them.
`;

async function main(argv: string[]): Promise<number> {
  const command = argv[0];
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }

  const { values } = parseArgs({
    args: argv.slice(1),
    allowPositionals: true,
    options: {
      corpus: { type: 'string' },
      preset: { type: 'string' },
      chunk: { type: 'string' },
      track: { type: 'string' },
      reviewer: { type: 'string' },
      reason: { type: 'string' },
      notes: { type: 'string' },
      seed: { type: 'string' },
      transcriber: { type: 'string' },
      formats: { type: 'string' },
      providers: { type: 'string' },
      'allow-unscored': { type: 'boolean' },
      chunks: { type: 'string' },
      runs: { type: 'string' },
      budget: { type: 'string' },
      style: { type: 'string' },
      voice: { type: 'string' },
      'dry-run': { type: 'boolean' },
      force: { type: 'boolean' },
      'allow-auto': { type: 'boolean' },
      root: { type: 'string' },
    },
  });

  const root = values.root;
  const log = (line: string) => process.stdout.write(`${line}\n`);

  switch (command) {
    case 'ingest':
      log(await ingest({ root, corpus: values.corpus }));
      return 0;

    case 'render':
      log(
        await render({
          root,
          corpus: values.corpus,
          preset: values.preset,
          chunk: values.chunk,
          transcriber: values.transcriber,
          formats: values.formats === undefined ? undefined : codecs(values.formats),
          seed: values.seed === undefined ? undefined : numeric(values.seed, '--seed'),
          force: values.force === true,
          onProgress: log,
        }),
      );
      return 0;

    case 'approve':
      log(
        recordVerdict({
          root,
          trackId: required(values.track, '--track'),
          verdict: 'approve',
          reviewer: required(values.reviewer, '--reviewer'),
          notes: values.notes,
        }),
      );
      return 0;

    case 'reject':
      log(
        recordVerdict({
          root,
          trackId: required(values.track, '--track'),
          verdict: 'reject',
          reviewer: required(values.reviewer, '--reviewer'),
          reason: rejectReason(required(values.reason, '--reason')),
          notes: values.notes,
        }),
      );
      return 0;

    case 'auto-approve':
      log(autoApprove({ root, corpus: values.corpus }));
      return 0;

    case 'publish':
      log(
        await publish({
          root,
          corpus: values.corpus,
          allowAuto: values['allow-auto'] === true,
          onProgress: log,
        }),
      );
      return 0;

    case 'verify':
      log(await verify({ root }));
      return 0;

    case 'status':
      log(status({ root }));
      return 0;

    case 'bakeoff':
      log(
        await bakeoff({
          root,
          providers: values.providers?.split(',').map((p) => p.trim()),
          chunks: values.chunks?.split(',').map((c) => c.trim()),
          runs: values.runs === undefined ? undefined : numeric(values.runs, '--runs'),
          budgetUsd: values.budget === undefined ? undefined : numeric(values.budget, '--budget'),
          seed: values.seed === undefined ? undefined : numeric(values.seed, '--seed'),
          styleId: values.style,
          voiceId: values.voice,
          transcriber: values.transcriber,
          allowUnscored: values['allow-unscored'] === true,
          dryRun: values['dry-run'] === true,
          onProgress: log,
        }),
      );
      return 0;

    case 'adapters': {
      registerProviders(root);
      for (const adapter of listAdapters()) log(`${adapter.name.padEnd(18)} ${adapter.description}`);
      const providers = loadProviders(root);
      if (providers.length > 0) {
        log('');
        for (const provider of providers) {
          log(
            `${provider.config.name.padEnd(18)} ${provider.ready ? 'key present' : `needs ${provider.config.apiKeyEnv}`} · $${provider.config.costPerRenderUsd.toFixed(2)}/render · commercial use ${provider.config.modelTerms.commercialUse ? 'declared' : 'NOT confirmed'}`,
          );
        }
      }
      return 0;
    }

    case 'pilot': {
      log(await ingest({ root }));
      log(await render({ root, onProgress: log }));
      log(autoApprove({ root, reviewer: 'pilot' }));
      log(await publish({ root, allowAuto: true, onProgress: log }));
      log(await verify({ root }));
      log('');
      log(status({ root }));
      log('');
      log(
        'These tracks were approved by the auto checks, not by a person. Principle 3 still stands: a real corpus goes through the studio before it is published.',
      );
      return 0;
    }

    default:
      process.stderr.write(`unknown command: ${command}\n\n${USAGE}`);
      return 2;
  }
}

function required(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

function numeric(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${flag} must be a number, got ${value}`);
  return parsed;
}

function codecs(value: string): Codec[] {
  const parts = value.split(',').map((p) => p.trim());
  for (const part of parts) {
    if (part !== 'opus' && part !== 'aac') {
      throw new Error(`--formats takes opus and/or aac, got ${part}`);
    }
  }
  if (parts.length === 0) throw new Error('--formats needs at least one codec');
  return parts as Codec[];
}

const REJECT_REASONS = ['wrong-words', 'bad-audio', 'style-off', 'timing-off', 'other'] as const;

function rejectReason(value: string): RejectReason {
  if ((REJECT_REASONS as readonly string[]).includes(value)) return value as RejectReason;
  throw new Error(`--reason must be one of ${REJECT_REASONS.join(', ')}, got ${value}`);
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
