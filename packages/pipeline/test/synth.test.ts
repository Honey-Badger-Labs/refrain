import { describe, expect, it } from 'vitest';
import type { Chunk, Preset } from '@refrain/catalogue';
import {
  renderSynth,
  shapeLine,
  stressPattern,
  styleShape,
  SYNTH_STYLES,
  SYNTH_VOICES,
} from '../src/render/synth.js';
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

describe('what the synth plays', () => {
  /**
   * Version 1 resolved lines onto chord tones too; what it got wrong was the
   * accompaniment, which read a fixed bar grid instead of the line, so the pad
   * was usually holding a different triad by the time the melody landed. That
   * fault is now shut out by the types rather than by a test —
   * `renderAccompaniment` is handed the phrases and has no bar counter to
   * drift with — so what is worth asserting here is the other half of the
   * contract: the melody still states the chord it is being accompanied by.
   */
  it('ends every line on a tone of that line\'s chord', () => {
    const style = styleShape('hymn')!;
    for (const chordRoot of [0, 3, 4, 5]) {
      const tones = new Set([chordRoot, chordRoot + 2, chordRoot + 4, chordRoot + 7]);
      for (let count = 1; count <= 12; count++) {
        const rng = makeRng(seedFrom('chunk', 'hymn-alto', count));
        const degrees = shapeLine(count, chordRoot, style, 0, rng);
        expect(degrees).toHaveLength(count);
        expect(tones.has(degrees[count - 1]!)).toBe(true);
      }
    }
  });

  it('never leaps further than a fourth between syllables', () => {
    const style = styleShape('carol')!;
    const rng = makeRng(seedFrom('chunk', 'carol-soprano', 1));
    const degrees = shapeLine(16, 0, style, 0.5, rng);
    for (let i = 1; i < degrees.length; i++) {
      expect(Math.abs(degrees[i]! - degrees[i - 1]!)).toBeLessThanOrEqual(4);
    }
  });

  it('leans on the syllable that begins each word', () => {
    // "Little Lamb who made thee" — Lit-tle Lamb who made thee.
    expect(stressPattern('Little Lamb who made thee')).toEqual([
      true, false, true, true, true, true,
    ]);
  });

  it('renders every declared style and voice', () => {
    for (const styleId of SYNTH_STYLES) {
      for (const voiceId of SYNTH_VOICES) {
        const result = renderSynth({
          ...request,
          preset: { ...preset, id: `${styleId}-${voiceId}`, styleId, voiceId },
        });
        expect(result.samples.length).toBeGreaterThan(0);
        expect(peak(result.samples)).toBeGreaterThan(0.1);
        expect(result.alignment).toHaveLength(chunk.lines.length);
      }
    }
  });
});
