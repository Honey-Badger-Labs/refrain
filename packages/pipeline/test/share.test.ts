import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeSharePages, sharePathFor } from '../src/commands/share.js';
import type { Catalogue } from '@refrain/catalogue';

const catalogue = {
  schemaVersion: 1,
  corpus: {
    id: 'blake-songs',
    title: 'Songs',
    edition: 'e',
    author: 'William Blake',
    licence: { id: 'public-domain', name: 'Public domain' },
    sourceUrl: 'https://example.org/x',
    books: [{ id: 'innocence', title: 'Songs of Innocence', order: 0 }],
  },
  styles: [{ id: 'hymn', name: 'Hymn' }],
  voices: [{ id: 'alto', name: 'Alto', source: 'synthetic' }],
  presets: [
    { id: 'hymn-alto', mode: 'sung', styleId: 'hymn', voiceId: 'alto', adapter: 'synth', params: {} },
  ],
  chunks: [
    {
      id: 'the-lamb',
      corpusId: 'blake-songs',
      bookId: 'innocence',
      number: 1,
      title: 'The Lamb <& friends>',
      lines: ['Little Lamb "who" made thee'],
    },
  ],
  tracks: [
    {
      id: 'the-lamb--hymn-alto',
      chunkId: 'the-lamb',
      presetId: 'hymn-alto',
      status: 'published',
      sources: [
        {
          path: 'library/blake-songs/the-lamb/hymn-alto.abc.webm',
          mimeType: 'audio/webm; codecs="opus"',
          codec: 'opus',
          bitrateKbps: 32,
          bytes: 100,
          sha256: 'a'.repeat(64),
        },
      ],
      durationSeconds: 10,
      alignment: [{ lineIndex: 0, start: 0, end: 10 }],
    },
  ],
  generatedAt: '2026-09-19T00:00:00.000Z',
  contentHash: 'b'.repeat(64),
} as Catalogue;

let root: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'refrain-share-'));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('share pages', () => {
  it('writes one page per listening state', () => {
    expect(writeSharePages(root, catalogue)).toBe(1);
    expect(
      fs.existsSync(path.join(root, 'blake-songs', 'share', 'the-lamb--hymn-alto.html')),
    ).toBe(true);
  });

  it('agrees with the path the app builds', () => {
    const relative = sharePathFor('blake-songs', 'the-lamb', 'hymn-alto');
    expect(relative).toBe('library/blake-songs/share/the-lamb--hymn-alto.html');
    expect(fs.existsSync(path.join(root, relative.replace(/^library\//, '')))).toBe(true);
  });

  it('carries the poem into the Open Graph tags and redirects to the route', () => {
    const html = fs.readFileSync(
      path.join(root, 'blake-songs', 'share', 'the-lamb--hymn-alto.html'),
      'utf8',
    );
    expect(html).toContain('og:title');
    expect(html).toContain('William Blake');
    expect(html).toContain('#/blake-songs/alto/hymn/innocence/the-lamb');
  });

  it('escapes text rather than letting it become markup', () => {
    const html = fs.readFileSync(
      path.join(root, 'blake-songs', 'share', 'the-lamb--hymn-alto.html'),
      'utf8',
    );
    expect(html).toContain('The Lamb &lt;&amp; friends&gt;');
    expect(html).not.toContain('<& friends>');
    expect(html).toContain('&quot;who&quot;');
  });

  it('contains no script at all', () => {
    const html = fs.readFileSync(
      path.join(root, 'blake-songs', 'share', 'the-lamb--hymn-alto.html'),
      'utf8',
    );
    expect(html).not.toMatch(/<script/i);
    // An inline handler is an attribute, so it must follow whitespace: this is
    // not the same as looking for "on...=" anywhere, which matches "content=".
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/javascript:/i);
  });

  it('removes a page whose track is no longer published', () => {
    const stale = path.join(root, 'blake-songs', 'share', 'gone--hymn-alto.html');
    fs.writeFileSync(stale, 'old');
    writeSharePages(root, catalogue);
    expect(fs.existsSync(stale)).toBe(false);
  });
});
