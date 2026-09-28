import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Chunk, Preset } from '@refrain/catalogue';
import {
  createHttpAdapter,
  interpolate,
  readPath,
  validateProviderConfig,
  ProviderConfigError,
  type ProviderConfig,
} from '../src/render/http.js';
import { encodeWav } from '../src/audio/wav.js';
import { summarise } from '../src/commands/bakeoff.js';
import { hasFfmpeg } from './helpers/ffmpeg.js';

const vars = {
  apiKey: 'secret',
  prompt: 'sing it',
  lyrics: 'a\nb',
  title: 'The Lamb',
  style: 'hymn',
  voice: 'alto',
  seed: 7,
  durationMs: 45000,
  durationSeconds: 45,
};

describe('interpolate', () => {
  it('substitutes inside a string', () => {
    expect(interpolate('a {{style}} setting of {{title}}', vars)).toBe('a hymn setting of The Lamb');
  });

  it('keeps the variable type when the string is only a placeholder', () => {
    // The difference between a working request and a 422: a provider that
    // wants an integer must not receive "45000".
    expect(interpolate('{{durationMs}}', vars)).toBe(45000);
    expect(typeof interpolate('{{seed}}', vars)).toBe('number');
  });

  it('stringifies a number used inside a longer string', () => {
    expect(interpolate('seed={{seed}}', vars)).toBe('seed=7');
  });

  it('walks objects and arrays', () => {
    expect(interpolate({ a: ['{{voice}}', { b: '{{seed}}' }] }, vars)).toEqual({
      a: ['alto', { b: 7 }],
    });
  });

  it('throws on an unknown variable rather than sending "undefined"', () => {
    expect(() => interpolate('{{nope}}', vars)).toThrow(ProviderConfigError);
    expect(() => interpolate('x {{nope}} y', vars)).toThrow(/unknown variable/);
  });

  it('leaves non-strings alone', () => {
    expect(interpolate({ a: true, b: 3, c: null }, vars)).toEqual({ a: true, b: 3, c: null });
  });
});

describe('readPath', () => {
  const payload = { data: { id: 'abc', items: [{ url: 'https://x/1.mp3' }] }, status: 'done' };

  it.each([
    ['data.id', 'abc'],
    ['status', 'done'],
    ['data.items.0.url', 'https://x/1.mp3'],
    ['data.missing', null],
    ['nope.nope.nope', null],
  ])('%s → %s', (query, expected) => {
    expect(readPath(payload, query)).toBe(expected);
  });
});

describe('validateProviderConfig', () => {
  const good: ProviderConfig = {
    name: 'x',
    apiKeyEnv: 'X_KEY',
    costPerRenderUsd: 0.05,
    modelTerms: { commercialUse: true },
    request: { url: 'https://api.example.com/v1/x' },
    response: { kind: 'audio' },
  };

  it('accepts a complete config', () => {
    expect(validateProviderConfig(good, 'x.json').name).toBe('x');
  });

  it.each([
    ['no name', { ...good, name: undefined }, /needs a name/],
    ['no key variable', { ...good, apiKeyEnv: undefined }, /apiKeyEnv/],
    ['no cost', { ...good, costPerRenderUsd: undefined }, /costPerRenderUsd/],
    ['negative cost', { ...good, costPerRenderUsd: -1 }, /costPerRenderUsd/],
    ['no terms', { ...good, modelTerms: undefined }, /commercialUse/],
    ['no url', { ...good, request: {} }, /request.url/],
    ['bad response kind', { ...good, response: { kind: 'xml' } }, /response.kind/],
    [
      'json response with nothing to read',
      { ...good, response: { kind: 'json' } },
      /audioUrlPath or statusUrl/,
    ],
  ])('rejects %s', (_label, config, message) => {
    expect(() => validateProviderConfig(config, 'x.json')).toThrow(message);
  });

  it('refuses a config with a key pasted where the variable name goes', () => {
    expect(() =>
      validateProviderConfig(
        { ...good, apiKeyEnv: `sk-${'a'.repeat(48)}` },
        'x.json',
      ),
    ).toThrow(/never put a key in this file/i);
  });
});

// These three decode the provider's audio, which runs it through ffmpeg.
const itWithAudio = it.skipIf(!hasFfmpeg);

describe('the HTTP adapter', () => {
  let workDir: string;
  let wav: Buffer;

  const chunk: Chunk = {
    id: 'the-lamb',
    corpusId: 'c',
    bookId: 'b',
    number: 1,
    title: 'The Lamb',
    lines: ['Little Lamb who made thee', 'Dost thou know who made thee'],
  };
  const preset: Preset = {
    id: 'hymn-alto',
    mode: 'sung',
    styleId: 'hymn',
    voiceId: 'alto',
    adapter: 'x',
    params: {},
  };
  const request = { chunk, preset, lines: chunk.lines, seed: 3, sampleRate: 44100 };

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refrain-http-'));
    const samples = new Float32Array(8000);
    for (let i = 0; i < samples.length; i++) samples[i] = 0.4 * Math.sin((2 * Math.PI * 220 * i) / 8000);
    wav = encodeWav(samples, { sampleRate: 8000 });
    process.env.X_KEY = 'secret-value';
  });

  afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
    delete process.env.X_KEY;
  });

  const audioConfig: ProviderConfig = {
    name: 'x-audio',
    apiKeyEnv: 'X_KEY',
    costPerRenderUsd: 0.05,
    modelId: 'their-model',
    modelTerms: { commercialUse: true },
    request: {
      url: 'https://api.example.com/v1/music',
      headers: { 'xi-api-key': '{{apiKey}}' },
      body: { prompt: '{{prompt}}', music_length_ms: '{{durationMs}}', seed: '{{seed}}' },
    },
    response: { kind: 'audio' },
  };

  itWithAudio('posts the interpolated body and decodes the audio it gets back', async () => {
    const fetchImpl = vi.fn(async () => new Response(wav, { status: 200 }));
    const adapter = createHttpAdapter(audioConfig, {
      workDir,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await adapter.render(request);

    expect(result.samples.length).toBeGreaterThan(0);
    expect(result.sampleRate).toBe(44100);
    expect(result.performed).toEqual(chunk.lines);
    expect(result.modelId).toBe('their-model');

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.seed).toBe(3);
    expect(typeof body.music_length_ms).toBe('number');
    expect(String(body.prompt)).toContain('The Lamb');
    expect(String(body.prompt)).toContain('Little Lamb who made thee');
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('secret-value');
  });

  itWithAudio('returns no alignment rather than inventing one', async () => {
    const fetchImpl = vi.fn(async () => new Response(wav, { status: 200 }));
    const adapter = createHttpAdapter(audioConfig, {
      workDir,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    // A music API cannot know line timings. Guessing would silently pass the
    // alignment check, which is worse than reporting it unmeasured.
    expect((await adapter.render(request)).alignment).toEqual([]);
  });

  it('refuses to run without the key, and names the variable', async () => {
    const adapter = createHttpAdapter(
      { ...audioConfig, apiKeyEnv: 'NOT_SET_ANYWHERE' },
      { workDir, fetchImpl: (async () => new Response(wav)) as unknown as typeof fetch },
    );
    await expect(adapter.render(request)).rejects.toThrow(/NOT_SET_ANYWHERE/);
  });

  it('surfaces the provider error body rather than a bare status', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{"error":"quota exhausted"}', { status: 429 }),
    );
    const adapter = createHttpAdapter(audioConfig, {
      workDir,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(adapter.render(request)).rejects.toThrow(/429.*quota exhausted/s);
  });

  itWithAudio('polls a job until it is done, then downloads the audio', async () => {
    const pollConfig: ProviderConfig = {
      ...audioConfig,
      name: 'x-poll',
      response: {
        kind: 'json',
        idPath: 'data.id',
        statusUrl: 'https://api.example.com/v1/jobs/{{id}}',
        statusPath: 'data.status',
        doneValues: ['complete'],
        failValues: ['failed'],
        audioUrlPath: 'data.audio_url',
        intervalMs: 1,
        timeoutMs: 1000,
      },
    };

    let polls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/music')) {
        return new Response(JSON.stringify({ data: { id: 'job-1' } }), { status: 200 });
      }
      if (url.endsWith('/v1/jobs/job-1')) {
        polls++;
        const status = polls < 3 ? 'queued' : 'complete';
        return new Response(
          JSON.stringify({
            data: { status, ...(status === 'complete' ? { audio_url: 'https://cdn/x.wav' } : {}) },
          }),
          { status: 200 },
        );
      }
      return new Response(wav, { status: 200 });
    });

    const adapter = createHttpAdapter(pollConfig, {
      workDir,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });
    const result = await adapter.render(request);
    expect(result.samples.length).toBeGreaterThan(0);
    expect(polls).toBe(3);
  });

  it('stops on a reported failure instead of polling to the timeout', async () => {
    const pollConfig: ProviderConfig = {
      ...audioConfig,
      name: 'x-fail',
      response: {
        kind: 'json',
        idPath: 'id',
        statusUrl: 'https://api.example.com/v1/jobs/{{id}}',
        statusPath: 'status',
        failValues: ['failed'],
        audioUrlPath: 'audio_url',
        intervalMs: 1,
        timeoutMs: 1000,
      },
    };
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/v1/music')
        ? new Response(JSON.stringify({ id: 'j' }), { status: 200 })
        : new Response(JSON.stringify({ status: 'failed' }), { status: 200 }),
    );
    const adapter = createHttpAdapter(pollConfig, {
      workDir,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });
    await expect(adapter.render(request)).rejects.toThrow(/failed/);
  });

  it('gives up with a useful message when a job never finishes', async () => {
    const pollConfig: ProviderConfig = {
      ...audioConfig,
      name: 'x-slow',
      response: {
        kind: 'json',
        idPath: 'id',
        statusUrl: 'https://api.example.com/v1/jobs/{{id}}',
        statusPath: 'status',
        doneValues: ['complete'],
        audioUrlPath: 'audio_url',
        intervalMs: 1,
        timeoutMs: 10,
      },
    };
    let clock = 0;
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/v1/music')
        ? new Response(JSON.stringify({ id: 'j' }), { status: 200 })
        : new Response(JSON.stringify({ status: 'queued' }), { status: 200 }),
    );
    const adapter = createHttpAdapter(pollConfig, {
      workDir,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {
        clock += 5;
      },
      now: () => clock,
    });
    await expect(adapter.render(request)).rejects.toThrow(/did not finish|timeoutMs/);
  });

  it('says so when the provider returns an error page instead of audio', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>nope</html>', { status: 200 }));
    const adapter = createHttpAdapter(audioConfig, {
      workDir,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(adapter.render(request)).rejects.toThrow();
  });
});

describe('bake-off summary', () => {
  const attempt = (provider: string, over: Record<string, unknown> = {}) => ({
    provider,
    chunkId: 'c',
    chunkTitle: 'C',
    run: 1,
    ok: true,
    costUsd: 0.1,
    renderSeconds: 20,
    report: { results: [], passed: true, incomplete: false },
    ...over,
  });

  it('averages accuracy and reports the worst case', () => {
    const [summary] = summarise([
      attempt('a', { wordAccuracy: 1 }),
      attempt('a', { wordAccuracy: 0.9 }),
    ] as never);
    expect(summary!.meanAccuracy).toBeCloseTo(0.95);
    expect(summary!.worstAccuracy).toBeCloseTo(0.9);
  });

  it('counts a failed render and does not bill a refusal', () => {
    const [summary] = summarise([
      attempt('a', { ok: false, error: 'HTTP 401 unauthorized', report: undefined }),
    ] as never);
    expect(summary!.failures).toBe(1);
    expect(summary!.meanAccuracy).toBeNull();
  });

  it('reports cost per usable render, not cost per attempt', () => {
    const [summary] = summarise([
      attempt('a', { wordAccuracy: 1 }),
      attempt('a', { wordAccuracy: 0.4, report: { results: [], passed: false, incomplete: false } }),
    ] as never);
    expect(summary!.checksPassed).toBe(1);
    expect(summary!.costPerUsableUsd).toBeCloseTo(0.2);
  });

  it('leaves cost per usable unset when nothing was usable', () => {
    const [summary] = summarise([
      attempt('a', { report: { results: [], passed: false, incomplete: false } }),
    ] as never);
    expect(summary!.costPerUsableUsd).toBeNull();
  });
});

/**
 * What a refused call costs.
 *
 * The headline and the table disagreed on a real run: three calls ElevenLabs
 * rejected for a bad key were billed $0.30 in one place and $0.00 in the
 * other. The refused-code list was enumerated and did not contain 400, which
 * is what that provider answers for a bad key.
 */
describe('a refused render', () => {
  const refused = (message: string) => /returned 4\d{2}\b/.test(message);

  it('counts every 4xx as declined, not just the ones someone listed', () => {
    for (const status of [400, 401, 402, 403, 404, 409, 422, 429]) {
      expect(refused(`elevenlabs-music returned ${status}: {"detail":"nope"}`)).toBe(true);
    }
  });

  it('still charges for a server error, which may have generated audio', () => {
    expect(refused('elevenlabs-music returned 500: upstream')).toBe(false);
    expect(refused('elevenlabs-music returned 503: busy')).toBe(false);
  });

  it('is not fooled by a number that happens to appear in a message', () => {
    expect(refused('elevenlabs-music failed after 404 seconds of audio')).toBe(false);
  });
});
