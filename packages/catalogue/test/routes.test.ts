import { describe, expect, it } from 'vitest';
import { parseRoute, resolveRoute, routeToHash, routeForChunk } from '../src/routes.js';
import { makeCatalogue } from './fixtures.js';

describe('parseRoute', () => {
  it('accepts a well-formed route', () => {
    expect(parseRoute('#/blake-songs/alto/hymn/innocence/the-lamb')).toEqual({
      corpusId: 'blake-songs',
      voiceId: 'alto',
      styleId: 'hymn',
      bookId: 'innocence',
      chunkId: 'the-lamb',
    });
  });

  it('accepts the route without a leading hash and with a trailing slash', () => {
    expect(parseRoute('/blake-songs/alto/hymn/innocence/the-lamb/')).not.toBeNull();
  });

  it('ignores a query string appended to the hash', () => {
    expect(parseRoute('#/blake-songs/alto/hymn/innocence/the-lamb?t=12')).not.toBeNull();
  });

  it.each([
    ['too few segments', '#/blake-songs/alto/hymn'],
    ['too many segments', '#/a/b/c/d/e/f'],
    ['empty', '#'],
    ['uppercase', '#/Blake/alto/hymn/innocence/the-lamb'],
    ['underscore', '#/blake_songs/alto/hymn/innocence/the-lamb'],
    ['dot segment', '#/../alto/hymn/innocence/the-lamb'],
    ['script tag', '#/<script>/alto/hymn/innocence/the-lamb'],
    ['encoded script tag', '#/%3Cscript%3E/alto/hymn/innocence/the-lamb'],
    ['javascript url', '#/javascript:alert(1)/a/b/c/d'],
    ['null byte', '#/blake%00/alto/hymn/innocence/the-lamb'],
    ['broken percent encoding', '#/blake%/alto/hymn/innocence/the-lamb'],
    ['leading hyphen', '#/-blake/alto/hymn/innocence/the-lamb'],
    ['double hyphen is fine in ids but not here', '#/blake--songs/alto/hymn/innocence/the-lamb'],
  ])('rejects %s', (_label, hash) => {
    expect(parseRoute(hash)).toBeNull();
  });

  it('rejects an absurdly long hash without touching the catalogue', () => {
    expect(parseRoute(`#/${'a'.repeat(2000)}/b/c/d/e`)).toBeNull();
  });
});

describe('resolveRoute', () => {
  const catalogue = makeCatalogue();

  it('resolves a route that exists', () => {
    const route = parseRoute('#/blake-songs/alto/hymn/innocence/the-lamb');
    const resolved = resolveRoute(catalogue, route!);
    expect(resolved?.chunk.title).toBe('The Lamb');
    expect(resolved?.track.presetId).toBe('hymn-alto');
  });

  it('returns null when the chunk is in another book', () => {
    const resolved = resolveRoute(catalogue, {
      corpusId: 'blake-songs',
      voiceId: 'alto',
      styleId: 'hymn',
      bookId: 'experience',
      chunkId: 'the-lamb',
    });
    expect(resolved).toBeNull();
  });

  it('returns null for a style and voice pair with no preset', () => {
    const resolved = resolveRoute(catalogue, {
      corpusId: 'blake-songs',
      voiceId: 'treble',
      styleId: 'folk',
      bookId: 'innocence',
      chunkId: 'the-lamb',
    });
    expect(resolved).toBeNull();
  });

  it('round-trips through routeToHash', () => {
    const route = parseRoute('#/blake-songs/alto/hymn/innocence/the-lamb')!;
    expect(parseRoute(routeToHash(route))).toEqual(route);
  });
});

describe('routeForChunk', () => {
  const catalogue = makeCatalogue();

  it('prefers the requested style and voice', () => {
    expect(routeForChunk(catalogue, 'the-lamb', { styleId: 'folk', voiceId: 'alto' })).toMatchObject(
      { styleId: 'folk', voiceId: 'alto' },
    );
  });

  it('falls back to a preset that has a track', () => {
    expect(
      routeForChunk(catalogue, 'the-lamb', { styleId: 'nonexistent', voiceId: 'nonexistent' }),
    ).not.toBeNull();
  });

  it('returns null for a chunk with no tracks', () => {
    expect(routeForChunk(catalogue, 'not-a-chunk')).toBeNull();
  });
});
