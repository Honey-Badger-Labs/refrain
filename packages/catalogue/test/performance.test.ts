import { describe, expect, it } from 'vitest';
import { TrackSchema } from '../src/schema.js';
import { linePerformance, performanceOf, performancesOf, asTokenSpans } from '../src/performance.js';
import { track } from './fixtures.js';

const lines = ['Tyger Tyger, burning bright', 'In the forests of the night'];

/** A ukulele chart over the same two bars: the shapes, and when each is held. */
const chords = {
  kind: 'chord' as const,
  tokens: ['C', 'Am', 'F', 'G7'],
  spans: [
    { index: 0, start: 0, end: 2 },
    { index: 1, start: 2, end: 4 },
    { index: 2, start: 4, end: 6 },
    { index: 3, start: 6, end: 8 },
  ],
};

describe('a track as performances', () => {
  it('presents the words as the line performance', () => {
    const t = TrackSchema.parse(track('the-tyger', 'hymn-alto'));
    const words = linePerformance(t, lines);

    expect(words.kind).toBe('line');
    expect(words.tokens).toEqual(lines);
    expect(words.spans).toEqual([
      { index: 0, start: 0, end: 4 },
      { index: 1, start: 4, end: 8 },
    ]);
  });

  it('puts the words first and any other stream after', () => {
    const t = TrackSchema.parse({ ...track('the-tyger', 'hymn-alto'), performances: [chords] });

    expect(performancesOf(t, lines).map((p) => p.kind)).toEqual(['line', 'chord']);
    expect(performanceOf(t, 'chord', lines)?.tokens).toEqual(['C', 'Am', 'F', 'G7']);
  });

  it('answers null for a kind this take does not carry', () => {
    const t = TrackSchema.parse(track('the-tyger', 'hymn-alto'));
    expect(performanceOf(t, 'chord', lines)).toBeNull();
    expect(performanceOf(t, 'note', lines)).toBeNull();
  });

  /**
   * The reason `performances` is optional rather than defaulted. Every
   * published catalogue carries a content hash the app recomputes and refuses
   * on mismatch (invariant 4), so a track with nothing extra has to serialise
   * byte-for-byte as it did before this field existed.
   */
  it('does not appear in a track that has none, so existing hashes hold', () => {
    const before = track('the-tyger', 'hymn-alto');
    const after = TrackSchema.parse(before);

    expect('performances' in after).toBe(false);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it('keeps the wire spelling of the words and the shared spelling of the rest', () => {
    // `lineIndex` on the wire, `index` once it is a token span. Both say the
    // same thing; only one of them can be renamed without invalidating a hash.
    const t = TrackSchema.parse(track('the-tyger', 'hymn-alto'));
    expect(t.alignment[0]).toHaveProperty('lineIndex');
    expect(asTokenSpans(t.alignment)[0]).toHaveProperty('index');
  });
});
