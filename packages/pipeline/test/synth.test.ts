import { describe, expect, it } from 'vitest';
import type { Chunk, Preset } from '@refrain/catalogue';
import { renderSynth } from '../src/render/synth.js';
import { RenderError } from '../src/render/types.js';
import { peak } from '../src/audio/wav.js';
import { makeRng, seedFrom } from '../src/render/random.js';

const chunk: Chunk = {
  id: 'the-lamb',
  corpusId: 'blake-songs',
  bookId: 'innocence',
  number: 1,
  title: 'The Lamb',
  lines: ['Little Lamb who made thee', 'Dost thou know who made thee'],
};

const preset: Preset = {
  id: 'hymn-alto',
  mode: 'sung',
  styleId: 'hymn',
  voiceId: 'alto',
  adapter: 'synth',
  params: {},
};

const request = { chunk, preset, lines: chunk.lines, seed: 1, sampleRate: 22050 };

describe('renderSynth', () => {
  it('produces audio of a plausible length', () => {
    const result = renderSynth(request);
    const seconds = result.samples.length / result.sampleRate;
    expect(seconds).toBeGreaterThan(4);
    expect(seconds).toBeLessThan(60);
  });

  it('is deterministic for the same recipe', () => {
    const a = renderSynth(request);
    const b = renderSynth(request);
    expect(a.samples.length).toBe(b.samples.length);
    expect(a.alignment).toEqual(b.alignment);
    // Sample-for-sample, not just structurally: a re-render must be the file.
    let identical = true;
    for (let i = 0; i < a.samples.length; i += 97) {
      if (a.samples[i] !== b.samples[i]) {
        identical = false;
        break;
      }
    }
    expect(identical).toBe(true);
  });

  it('differs when the seed differs', () => {
    const a = renderSynth(request);
    const b = renderSynth({ ...request, seed: 2 });
    let differs = false;
    for (let i = 0; i < Math.min(a.samples.length, b.samples.length); i += 31) {
      if (a.samples[i] !== b.samples[i]) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });

  it('returns one alignment span per line, in order, inside the audio', () => {
    const result = renderSynth(request);
    const seconds = result.samples.length / result.sampleRate;
    expect(result.alignment).toHaveLength(chunk.lines.length);
    let previous = -1;
    for (const span of result.alignment) {
      expect(span.start).toBeGreaterThan(previous);
      expect(span.end).toBeGreaterThan(span.start);
      expect(span.end).toBeLessThanOrEqual(seconds);
      previous = span.start;
    }
  });

  it('never clips', () => {
    expect(peak(renderSynth(request).samples)).toBeLessThan(1);
  });

  it('a slower style takes longer than a brisker one', () => {
    const hymn = renderSynth(request);
    const folk = renderSynth({
      ...request,
      preset: { ...preset, id: 'folk-alto', styleId: 'folk' },
    });
    expect(hymn.samples.length).toBeGreaterThan(folk.samples.length);
  });

  it('refuses a style or voice it has no shape for', () => {
    expect(() => renderSynth({ ...request, preset: { ...preset, styleId: 'techno' } })).toThrow(
      RenderError,
    );
    expect(() => renderSynth({ ...request, preset: { ...preset, voiceId: 'bass' } })).toThrow(
      /no shape for voice/,
    );
  });

  it('refuses a chunk with no lines', () => {
    expect(() => renderSynth({ ...request, lines: [] })).toThrow(/no lines/);
  });

  it('reports what it performed, for the accuracy check to judge', () => {
    expect(renderSynth(request).performed).toEqual(chunk.lines);
  });
});

describe('deterministic randomness', () => {
  it('seeds identically for identical inputs', () => {
    expect(seedFrom('a', 'b', 1)).toBe(seedFrom('a', 'b', 1));
    expect(seedFrom('a', 'b', 1)).not.toBe(seedFrom('a', 'b', 2));
  });

  it('stays inside [0, 1) and inside the range asked for', () => {
    const rng = makeRng(seedFrom('x'));
    for (let i = 0; i < 1000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(rng.int(5)).toBeLessThan(5);
    }
  });

  it('refuses to pick from nothing', () => {
    expect(() => makeRng(1).pick([])).toThrow();
  });
});
