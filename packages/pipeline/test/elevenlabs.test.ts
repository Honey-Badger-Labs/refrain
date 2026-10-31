import { describe, expect, it } from 'vitest';
import type { Preset } from '@refrain/catalogue';
import { buildCompositionPlan, createElevenLabsAdapter, MAX_SECTION_MS } from '../src/render/elevenlabs.js';

const preset = { styleId: 'hymn', voiceId: 'alto' } as unknown as Preset;
const lines = ['Little Lamb, who made thee?', 'Dost thou know who made thee?', 'Gave thee life, and bid thee feed', 'By the stream and o\'er the mead;', 'Gave thee clothing of delight,'];

describe('buildCompositionPlan', () => {
  it('keeps every word, in order, across sections', () => {
    const plan = buildCompositionPlan({ lines, preset });
    expect(plan.sections.flatMap((s) => s.lines)).toEqual(lines);
    expect(plan.sections).toHaveLength(2);
  });
  it('maps the style and clamps section length', () => {
    const plan = buildCompositionPlan({ lines, preset }, { msPerLine: 999_999 });
    expect(plan.positive_global_styles[0]).toMatch(/hymn/);
    for (const s of plan.sections) expect(s.duration_ms).toBeLessThanOrEqual(MAX_SECTION_MS);
  });
  it('refuses empty text', () => {
    expect(() => buildCompositionPlan({ lines: ['  '], preset })).toThrow();
  });
});

describe('createElevenLabsAdapter', () => {
  it('fails clearly without a key and never calls out', async () => {
    let called = false;
    const adapter = createElevenLabsAdapter({ apiKeyEnv: 'REFRAIN_TEST_NO_KEY', workDir: '/tmp', fetchImpl: (async () => { called = true; return new Response(''); }) as typeof fetch });
    await expect(adapter.render({ lines, preset, seed: 1, sampleRate: 44100, chunk: {} as never })).rejects.toThrow(/not set/);
    expect(called).toBe(false);
  });
  it('does not leak the key in an error', async () => {
    process.env.REFRAIN_TEST_KEY = 'sk_should_not_appear';
    const adapter = createElevenLabsAdapter({ apiKeyEnv: 'REFRAIN_TEST_KEY', workDir: '/tmp', fetchImpl: (async () => new Response('bad', { status: 422 })) as typeof fetch });
    const err = await adapter.render({ lines, preset, seed: 1, sampleRate: 44100, chunk: {} as never }).catch((e: Error) => e);
    expect(String(err)).toMatch(/422/);
    expect(String(err)).not.toMatch(/sk_should_not_appear/);
    delete process.env.REFRAIN_TEST_KEY;
  });
});
