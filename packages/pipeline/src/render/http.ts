import type { AlignmentSpan } from '@refrain/catalogue';
import { syllablesInLine } from '../text/words.js';
import { decodeToSamples } from '../audio/decode.js';
import { RenderError, type RenderAdapter, type RenderRequest, type RenderResult } from './types.js';

/**
 * A render adapter for any music API, described by a JSON file.
 *
 * Every provider wants a slightly different body and answers in a slightly
 * different shape, and a bake-off is worthless if each contender needs its own
 * hand-written client — you end up comparing the clients. So a provider is a
 * config file: where to post, what to send, and where the audio comes back.
 * Adding a contender is a JSON file, not a pull request.
 *
 * Two response shapes cover what is out there. `audio` means the endpoint
 * answers with the bytes (ElevenLabs Music does this). `json` means it answers
 * with a job to poll and then a URL to fetch.
 *
 * What this adapter deliberately does NOT do is invent alignment. A music API
 * returns audio, not line timings, so `alignment` comes back empty and the
 * alignment check reports `skipped`. That is the honest state until a forced
 * aligner is wired in, and it keeps a bake-off from quietly claiming a
 * capability it does not have.
 */

export interface ProviderConfig {
  name: string;
  description?: string;
  /** Environment variable holding the key. Never the key itself. */
  apiKeyEnv: string;
  /** What one render costs, from the provider's own pricing page. */
  costPerRenderUsd: number;
  modelId?: string;
  modelTerms: {
    url?: string;
    version?: string;
    checkedOn?: string;
    commercialUse: boolean;
  };
  /** Default prompt when a preset does not carry its own template. */
  promptTemplate?: string;
  request: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
  response: AudioResponse | JsonResponse;
}

interface AudioResponse {
  kind: 'audio';
}

interface JsonResponse {
  kind: 'json';
  /** Dotted path to the audio URL in the first response, if it is immediate. */
  audioUrlPath?: string;
  /** Otherwise: the job id, and where to poll for it. */
  idPath?: string;
  statusUrl?: string;
  statusHeaders?: Record<string, string>;
  statusPath?: string;
  doneValues?: string[];
  failValues?: string[];
  intervalMs?: number;
  timeoutMs?: number;
}

export class ProviderConfigError extends Error {}

export function validateProviderConfig(value: unknown, source: string): ProviderConfig {
  const config = value as Partial<ProviderConfig>;
  const fail = (message: string) => {
    throw new ProviderConfigError(`${source}: ${message}`);
  };
  if (!config.name) fail('needs a name');
  if (!config.apiKeyEnv) fail('needs apiKeyEnv, the name of the variable holding the key');
  if (config.apiKeyEnv && /[-.]|^sk|key$/i.test(config.apiKeyEnv) && config.apiKeyEnv.length > 40) {
    fail('apiKeyEnv looks like a key, not a variable name. Never put a key in this file.');
  }
  if (typeof config.costPerRenderUsd !== 'number' || config.costPerRenderUsd < 0) {
    fail('needs costPerRenderUsd so the bake-off can add up what it is spending');
  }
  if (!config.modelTerms || typeof config.modelTerms.commercialUse !== 'boolean') {
    fail('needs modelTerms.commercialUse: whether the output may be used commercially');
  }
  if (!config.request?.url) fail('needs request.url');
  const kind = config.response?.kind;
  if (kind !== 'audio' && kind !== 'json') fail('response.kind must be "audio" or "json"');
  if (kind === 'json') {
    const response = config.response as JsonResponse;
    if (!response.audioUrlPath && !response.statusUrl) {
      fail('a json response needs either audioUrlPath or statusUrl to poll');
    }
  }
  return config as ProviderConfig;
}

/** Variables a provider config may interpolate with `{{name}}`. */
export interface TemplateVars {
  apiKey: string;
  prompt: string;
  lyrics: string;
  title: string;
  style: string;
  voice: string;
  seed: number;
  durationMs: number;
  durationSeconds: number;
  [key: string]: string | number;
}

/**
 * Substitute `{{name}}` through a JSON structure.
 *
 * A string that is *only* a placeholder takes the variable's own type, so
 * `"music_length_ms": "{{durationMs}}"` sends a number rather than a string —
 * which is the difference between a working request and a 422 that costs an
 * afternoon to find.
 */
export function interpolate(value: unknown, vars: TemplateVars): unknown {
  if (typeof value === 'string') {
    const whole = /^\{\{(\w+)\}\}$/.exec(value);
    if (whole) {
      const found = vars[whole[1]!];
      if (found === undefined) throw new ProviderConfigError(`unknown variable {{${whole[1]}}}`);
      return found;
    }
    return value.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
      const found = vars[name];
      if (found === undefined) throw new ProviderConfigError(`unknown variable {{${name}}}`);
      return String(found);
    });
  }
  if (Array.isArray(value)) return value.map((item) => interpolate(item, vars));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = interpolate(item, vars);
    return out;
  }
  return value;
}

/** Read a dotted path out of a JSON response. Returns null rather than throwing. */
export function readPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return null;
    const index = Number.parseInt(segment, 10);
    current = Array.isArray(current)
      ? (current[Number.isNaN(index) ? -1 : index] ?? null)
      : ((current as Record<string, unknown>)[segment] ?? null);
  }
  return current ?? null;
}

const DEFAULT_PROMPT =
  'A {{style}} setting of the poem "{{title}}", sung clearly by a single {{voice}} voice. ' +
  'Every word must be sung exactly as written, in order, with no words added, repeated or left out. ' +
  'Lyrics:\n{{lyrics}}';

export interface HttpAdapterOptions {
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Where to put the downloaded file before decoding. */
  workDir: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export function createHttpAdapter(
  config: ProviderConfig,
  options: HttpAdapterOptions,
): RenderAdapter {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  return {
    name: config.name,
    description: config.description ?? `HTTP music API (${config.request.url})`,
    async render(request: RenderRequest): Promise<RenderResult> {
      const apiKey = process.env[config.apiKeyEnv];
      if (!apiKey) {
        throw new RenderError(
          `${config.name} needs ${config.apiKeyEnv} in the environment. Set it and run again; it is never read from the config file.`,
        );
      }

      const vars = templateVars(config, request, apiKey);
      const url = interpolate(config.request.url, vars) as string;
      const headers = interpolate(config.request.headers ?? {}, vars) as Record<string, string>;
      const body = config.request.body === undefined ? undefined : interpolate(config.request.body, vars);

      const response = await doFetch(url, {
        method: config.request.method ?? 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        throw new RenderError(
          `${config.name} returned ${response.status}: ${(await safeText(response)).slice(0, 400)}`,
        );
      }

      const bytes =
        config.response.kind === 'audio'
          ? new Uint8Array(await response.arrayBuffer())
          : await followJson(config, config.response, response, vars, { doFetch, sleep, ...(options.now ? { now: options.now } : {}) });

      const { samples, sampleRate } = await decodeToSamples(bytes, options.workDir);

      return {
        samples,
        sampleRate,
        // Empty on purpose: this adapter cannot know line timings, and an
        // invented alignment would silently pass the alignment check.
        alignment: [] as AlignmentSpan[],
        performed: request.lines,
        ...(config.modelId ? { modelId: config.modelId } : {}),
        modelTerms: config.modelTerms,
      };
    },
  };
}

async function followJson(
  config: ProviderConfig,
  response: JsonResponse,
  first: Response,
  vars: TemplateVars,
  deps: { doFetch: typeof fetch; sleep: (ms: number) => Promise<void>; now?: () => number },
): Promise<Uint8Array> {
  const now = deps.now ?? Date.now;
  const payload = (await first.json()) as unknown;

  const immediate = response.audioUrlPath ? readPath(payload, response.audioUrlPath) : null;
  if (typeof immediate === 'string') return download(immediate, deps.doFetch, config.name);

  if (!response.statusUrl) {
    throw new RenderError(
      `${config.name} answered with JSON but no audio URL at ${response.audioUrlPath ?? '(unset)'}`,
    );
  }

  const id = response.idPath ? readPath(payload, response.idPath) : null;
  if (id === null) {
    throw new RenderError(`${config.name} answered with no job id at ${response.idPath ?? '(unset)'}`);
  }

  const statusUrl = interpolate(response.statusUrl, { ...vars, id: String(id) }) as string;
  const headers = interpolate(response.statusHeaders ?? {}, vars) as Record<string, string>;
  const interval = response.intervalMs ?? 4000;
  const timeout = response.timeoutMs ?? 300_000;
  const deadline = now() + timeout;

  while (now() < deadline) {
    await deps.sleep(interval);
    const polled = await deps.doFetch(statusUrl, { headers });
    if (!polled.ok) continue;
    const state = (await polled.json()) as unknown;

    if (response.statusPath) {
      const status = String(readPath(state, response.statusPath) ?? '');
      if ((response.failValues ?? ['failed', 'error']).includes(status)) {
        throw new RenderError(`${config.name} reported the render ${status}`);
      }
      const done = response.doneValues ?? ['complete', 'completed', 'succeeded', 'success'];
      if (!done.includes(status)) continue;
    }

    const audioUrl = response.audioUrlPath ? readPath(state, response.audioUrlPath) : null;
    if (typeof audioUrl === 'string') return download(audioUrl, deps.doFetch, config.name);
  }

  throw new RenderError(
    `${config.name} did not finish within ${Math.round(timeout / 1000)}s. Raise response.timeoutMs if that provider is simply slow.`,
  );
}

async function download(url: string, doFetch: typeof fetch, name: string): Promise<Uint8Array> {
  const response = await doFetch(url);
  if (!response.ok) throw new RenderError(`${name}: downloading the audio returned ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function templateVars(
  config: ProviderConfig,
  request: RenderRequest,
  apiKey: string,
): TemplateVars {
  const lyrics = request.lines.join('\n');
  const syllables = request.lines.reduce((sum, line) => sum + syllablesInLine(line), 0);
  // Ask for roughly the length the auto checks expect, so a provider that
  // takes a duration does not hand back something the duration check rejects.
  const durationSeconds = Math.max(15, Math.min(300, Math.round(syllables * 0.6)));

  const base: TemplateVars = {
    apiKey,
    prompt: '',
    lyrics,
    title: request.chunk.title,
    style: request.preset.styleId,
    voice: request.preset.voiceId,
    seed: request.seed,
    durationMs: durationSeconds * 1000,
    durationSeconds,
  };

  const template = request.preset.promptTemplate ?? config.promptTemplate ?? DEFAULT_PROMPT;
  base.prompt = interpolate(template, base) as string;
  return base;
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '(no body)';
  }
}
