import { describe, expect, it } from 'vitest';
import { viewFromHash, bookHash, rightsHash, homeHash } from '../src/lib/router.js';

describe('viewFromHash', () => {
  it('reads the listening route', () => {
    const view = viewFromHash('#/blake-songs/alto/hymn/innocence/the-lamb');
    expect(view).toEqual({
      name: 'listen',
      route: {
        corpusId: 'blake-songs',
        voiceId: 'alto',
        styleId: 'hymn',
        bookId: 'innocence',
        chunkId: 'the-lamb',
      },
    });
  });

  it.each([
    ['#/', 'home'],
    ['', 'home'],
    ['#', 'home'],
    ['#/rights', 'rights'],
    ['#/book/innocence', 'book'],
  ])('%s is the %s view', (hash, name) => {
    expect(viewFromHash(hash).name).toBe(name);
  });

  it('keeps the book id it read', () => {
    const view = viewFromHash('#/book/experience');
    expect(view).toEqual({ name: 'book', bookId: 'experience' });
  });

  it.each([
    '#/book/<script>',
    '#/book/../../etc',
    '#/book/Innocence',
    '#/book/%',
    `#/book/${'a'.repeat(100)}`,
    '#/nope/nope',
    '#/rights/extra',
  ])('treats %s as unknown rather than guessing', (hash) => {
    expect(viewFromHash(hash).name).toBe('unknown');
  });

  it('never mistakes a five-segment route for another view', () => {
    expect(viewFromHash('#/book/a/b/c/d').name).toBe('listen');
  });

  it('builds the hashes it can read back', () => {
    expect(viewFromHash(bookHash('innocence'))).toEqual({ name: 'book', bookId: 'innocence' });
    expect(viewFromHash(rightsHash).name).toBe('rights');
    expect(viewFromHash(homeHash).name).toBe('home');
  });
});
