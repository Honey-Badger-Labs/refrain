import { describe, expect, it } from 'vitest';
import { TrackSchema, CorpusSchema, CatalogueSchema } from '../src/schema.js';
import { slugify, trackId, isId } from '../src/ids.js';
import { makeCatalogue, track } from './fixtures.js';

describe('TrackSchema source paths', () => {
  const good = track('the-lamb', 'hymn-alto');
  const withPath = (path: string) => ({
    ...good,
    sources: [{ ...good.sources[0]!, path }],
  });

  it.each([
    ['absolute url', 'https://evil.example/x.m4a'],
    ['protocol relative', '//evil.example/x.m4a'],
    ['javascript url', 'javascript:alert(1)'],
    ['data url', 'data:audio/mp4;base64,AAAA'],
    ['leading slash', '/library/x.m4a'],
    ['traversal', 'library/../../etc/passwd'],
    ['empty segment', 'library//x.m4a'],
    ['backslash', 'library\\x.m4a'],
  ])('rejects %s', (_label, path) => {
    expect(TrackSchema.safeParse(withPath(path)).success).toBe(false);
  });

  it('accepts a plain relative path', () => {
    expect(TrackSchema.safeParse(good).success).toBe(true);
  });

  it('refuses a track with no sources at all', () => {
    expect(TrackSchema.safeParse({ ...good, sources: [] }).success).toBe(false);
  });

  it('refuses an unknown codec', () => {
    const bad = { ...good, sources: [{ ...good.sources[0]!, codec: 'wma' }] };
    expect(TrackSchema.safeParse(bad).success).toBe(false);
  });
});

describe('CorpusSchema', () => {
  it('requires an https source url', () => {
    const corpus = { ...makeCatalogue().corpus, sourceUrl: 'http://example.org/blake' };
    expect(CorpusSchema.safeParse(corpus).success).toBe(false);
  });

  it('requires at least one book', () => {
    const corpus = { ...makeCatalogue().corpus, books: [] };
    expect(CorpusSchema.safeParse(corpus).success).toBe(false);
  });
});

describe('CatalogueSchema', () => {
  it('refuses a catalogue carrying an unpublished track', () => {
    const catalogue = makeCatalogue();
    const bad = {
      ...catalogue,
      tracks: [{ ...catalogue.tracks[0]!, status: 'candidate' }],
    };
    expect(CatalogueSchema.safeParse(bad).success).toBe(false);
  });

  it('refuses a malformed content hash', () => {
    expect(CatalogueSchema.safeParse({ ...makeCatalogue(), contentHash: 'nope' }).success).toBe(
      false,
    );
  });
});

describe('ids', () => {
  it('slugifies titles', () => {
    expect(slugify('The Lamb')).toBe('the-lamb');
    expect(slugify("Nurse's Song")).toBe('nurses-song');
    expect(slugify('Ah! Sun-flower')).toBe('ah-sun-flower');
    expect(slugify('  Spaced  Out  ')).toBe('spaced-out');
  });

  it('throws when nothing survives slugification', () => {
    expect(() => slugify('!!!')).toThrow();
  });

  it('accepts only lowercase hyphenated ids', () => {
    expect(isId('the-lamb')).toBe(true);
    expect(isId('The-Lamb')).toBe(false);
    expect(isId('the--lamb')).toBe(false);
    expect(isId('-lamb')).toBe(false);
    expect(isId('lamb-')).toBe(false);
    expect(isId('')).toBe(false);
    expect(isId('a'.repeat(65))).toBe(false);
  });

  it('derives a stable track id', () => {
    expect(trackId('the-lamb', 'hymn-alto')).toBe('the-lamb--hymn-alto');
  });
});
