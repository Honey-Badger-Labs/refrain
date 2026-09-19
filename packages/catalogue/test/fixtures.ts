import type { Catalogue, Chunk, Preset, Style, Track, Voice, Corpus } from '../src/schema.js';

const hash = (seed: string) => seed.padEnd(64, '0').slice(0, 64).replace(/[^a-f0-9]/g, 'a');

export const corpus: Corpus = {
  id: 'blake-songs',
  title: 'Songs of Innocence and of Experience',
  edition: 'Facsimile of the 1794 combined issue',
  author: 'William Blake',
  year: 1794,
  licence: { id: 'public-domain', name: 'Public domain (author died 1827)' },
  sourceUrl: 'https://example.org/blake',
  books: [
    { id: 'innocence', title: 'Songs of Innocence', order: 0 },
    { id: 'experience', title: 'Songs of Experience', order: 1 },
  ],
};

export const styles: Style[] = [
  { id: 'hymn', name: 'Hymn' },
  { id: 'folk', name: 'Folk' },
];

export const voices: Voice[] = [
  { id: 'alto', name: 'Alto', source: 'synthetic' },
  { id: 'treble', name: 'Treble', source: 'synthetic' },
];

export const presets: Preset[] = [
  { id: 'hymn-alto', mode: 'sung', styleId: 'hymn', voiceId: 'alto', adapter: 'synth', params: {} },
  { id: 'folk-alto', mode: 'sung', styleId: 'folk', voiceId: 'alto', adapter: 'synth', params: {} },
];

export const chunks: Chunk[] = [
  {
    id: 'the-lamb',
    corpusId: 'blake-songs',
    bookId: 'innocence',
    number: 1,
    title: 'The Lamb',
    lines: ['Little Lamb who made thee', 'Dost thou know who made thee'],
  },
  {
    id: 'the-tyger',
    corpusId: 'blake-songs',
    bookId: 'experience',
    number: 1,
    title: 'The Tyger',
    lines: ['Tyger Tyger, burning bright', 'In the forests of the night'],
  },
];

export function track(chunkId: string, presetId: string, status: Track['status'] = 'published') {
  return {
    id: `${chunkId}--${presetId}`,
    chunkId,
    presetId,
    status,
    sources: [
      {
        path: `library/blake-songs/${chunkId}/${presetId}.webm`,
        mimeType: 'audio/webm; codecs="opus"',
        codec: 'opus',
        bitrateKbps: 32,
        bytes: 220_000,
        sha256: hash(`${chunkId}${presetId}opus`),
      },
      {
        path: `library/blake-songs/${chunkId}/${presetId}.m4a`,
        mimeType: 'audio/mp4; codecs="mp4a.40.2"',
        codec: 'aac',
        bitrateKbps: 48,
        bytes: 340_000,
        sha256: hash(`${chunkId}${presetId}aac`),
      },
    ],
    durationSeconds: 42.5,
    alignment: [
      { lineIndex: 0, start: 0, end: 4 },
      { lineIndex: 1, start: 4, end: 8 },
    ],
  } satisfies Track;
}

export const tracks: Track[] = [
  track('the-lamb', 'hymn-alto'),
  track('the-lamb', 'folk-alto'),
  track('the-tyger', 'hymn-alto'),
];

/** A catalogue shaped exactly as the published one, without running the builder. */
export function makeCatalogue(overrides: Partial<Catalogue> = {}): Catalogue {
  return {
    schemaVersion: 1,
    corpus,
    styles,
    voices,
    presets,
    chunks,
    tracks: tracks as Catalogue['tracks'],
    generatedAt: '2026-09-19T00:00:00.000Z',
    contentHash: hash('fixture'),
    ...overrides,
  };
}
