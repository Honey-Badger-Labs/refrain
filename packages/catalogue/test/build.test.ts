import { describe, expect, it } from 'vitest';
import { buildCatalogue, verifyCatalogue, CatalogueError, buildIndex } from '../src/build.js';
import { corpus, styles, voices, presets, chunks, tracks, track } from './fixtures.js';

const base = {
  corpus,
  styles,
  voices,
  presets,
  chunks,
  tracks,
  generatedAt: '2026-09-19T00:00:00.000Z',
};

describe('buildCatalogue', () => {
  it('produces a catalogue that verifies against its own hash', async () => {
    const catalogue = await buildCatalogue(base);
    expect(catalogue.tracks).toHaveLength(3);
    await expect(verifyCatalogue(catalogue)).resolves.toBe(true);
  });

  it('is deterministic: the same input hashes the same', async () => {
    const a = await buildCatalogue(base);
    const b = await buildCatalogue({ ...base, tracks: [...tracks].reverse() });
    expect(a.contentHash).toBe(b.contentHash);
  });

  it('changes the hash when a track changes', async () => {
    const a = await buildCatalogue(base);
    const b = await buildCatalogue({
      ...base,
      tracks: [...tracks.slice(1), { ...tracks[0]!, durationSeconds: 43 }],
    });
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it('fails verification when a byte is tampered with', async () => {
    const catalogue = await buildCatalogue(base);
    const tampered = {
      ...catalogue,
      tracks: catalogue.tracks.map((t, i) =>
        i === 0 ? { ...t, audioPath: 'library/evil.m4a' } : t,
      ),
    };
    await expect(verifyCatalogue(tampered as typeof catalogue)).resolves.toBe(false);
  });

  it('drops candidate, approved and rejected tracks', async () => {
    const catalogue = await buildCatalogue({
      ...base,
      tracks: [
        ...tracks,
        track('the-tyger', 'folk-alto', 'candidate'),
        track('the-lamb', 'folk-alto', 'rejected'),
      ],
    });
    expect(catalogue.tracks.every((t) => t.status === 'published')).toBe(true);
    expect(catalogue.tracks).toHaveLength(3);
  });

  it('drops chunks that have no published track', async () => {
    const catalogue = await buildCatalogue({
      ...base,
      tracks: tracks.filter((t) => t.chunkId === 'the-lamb'),
    });
    expect(catalogue.chunks.map((c) => c.id)).toEqual(['the-lamb']);
    expect(catalogue.corpus.books.map((b) => b.id)).toEqual(['innocence']);
  });

  it.each([
    [
      'a track naming an unknown chunk',
      { tracks: [...tracks, track('not-a-chunk', 'hymn-alto')] },
      /unknown chunk/,
    ],
    [
      'a track naming an unknown preset',
      { tracks: [...tracks, track('the-lamb', 'not-a-preset')] },
      /unknown preset/,
    ],
    [
      'a preset naming an unknown style',
      { presets: [...presets, { ...presets[0]!, id: 'bad', styleId: 'nope' }] },
      /unknown style/,
    ],
    ['no published track at all', { tracks: [] }, /no chunk has a published track/],
  ])('refuses %s', async (_label, override, message) => {
    await expect(buildCatalogue({ ...base, ...override })).rejects.toThrow(message);
  });

  it('refuses alignment that points past the end of the chunk', async () => {
    const bad = { ...track('the-lamb', 'hymn-alto'), alignment: [{ lineIndex: 9, start: 0, end: 1 }] };
    await expect(buildCatalogue({ ...base, tracks: [bad] })).rejects.toThrow(CatalogueError);
  });

  it('refuses a span that ends before it starts', async () => {
    const bad = { ...track('the-lamb', 'hymn-alto'), alignment: [{ lineIndex: 0, start: 5, end: 1 }] };
    await expect(buildCatalogue({ ...base, tracks: [bad] })).rejects.toThrow(/ends before/);
  });
});

describe('buildIndex', () => {
  it('summarises each corpus', async () => {
    const catalogue = await buildCatalogue(base);
    const index = buildIndex(
      [{ catalogue, path: 'library/blake-songs/catalogue.json' }],
      '2026-09-19T00:00:00.000Z',
    );
    expect(index.corpora[0]).toMatchObject({ id: 'blake-songs', trackCount: 3, chunkCount: 2 });
  });
});
