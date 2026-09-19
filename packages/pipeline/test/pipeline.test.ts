import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CatalogueSchema, verifyCatalogue } from '@refrain/catalogue';
import { ingest } from '../src/commands/ingest.js';
import { render } from '../src/commands/render.js';
import { autoApprove, recordVerdict } from '../src/commands/review.js';
import { publish } from '../src/commands/publish.js';
import { verify } from '../src/commands/verify.js';
import { JsonStore } from '../src/store.js';
import { registerAdapter } from '../src/render/types.js';
import { synthAdapter } from '../src/render/synth.js';

registerAdapter(synthAdapter);

/**
 * The pipeline, end to end, in a throwaway repository.
 *
 * Two short poems and one preset keeps it to a few seconds while still
 * exercising the thing that matters: that nothing reaches the public library
 * without a recorded approval, and that what does reach it verifies.
 */

let root: string;

const PRESETS = {
  styles: [{ id: 'hymn', name: 'Hymn' }],
  voices: [{ id: 'alto', name: 'Alto', source: 'synthetic' }],
  presets: [
    { id: 'hymn-alto', mode: 'sung', styleId: 'hymn', voiceId: 'alto', adapter: 'synth', params: {} },
  ],
};

const CORPUS = {
  corpus: {
    id: 'tiny',
    title: 'A Tiny Corpus',
    edition: 'test fixture',
    author: 'Nobody',
    licence: { id: 'public-domain', name: 'Public domain' },
    sourceUrl: 'https://example.org/tiny',
    books: [{ id: 'one', title: 'Book One', order: 0 }],
  },
};

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'refrain-pipeline-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'refrain' }));
  const corpusDir = path.join(root, 'content', 'corpora', 'tiny');
  fs.mkdirSync(path.join(corpusDir, 'source'), { recursive: true });
  fs.writeFileSync(path.join(corpusDir, 'corpus.json'), JSON.stringify(CORPUS));
  fs.writeFileSync(
    path.join(root, 'content', 'presets.json'),
    JSON.stringify(PRESETS),
  );
  fs.writeFileSync(
    path.join(corpusDir, 'source', 'one--02-second.txt'),
    'Second Poem\n\nA short second line\nAnd one more after it\n',
  );
  fs.writeFileSync(
    path.join(corpusDir, 'source', 'one--01-first.txt'),
    'First Poem\n\nA short first line\nAnd another line here\n',
  );

  await ingest({ root });
  await render({ root, formats: ['opus'] });
}, 120_000);

afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

const store = () => new JsonStore(path.join(root, 'data', 'store.json')).read();

describe('ingest', () => {
  it('numbers chunks by the order in the file name, not the alphabet', () => {
    const chunks = store().chunks;
    expect(chunks.find((c) => c.id === 'first-poem')?.number).toBe(1);
    expect(chunks.find((c) => c.id === 'second-poem')?.number).toBe(2);
  });

  it('gives each chunk an id derived from its title', () => {
    expect(store().chunks.map((c) => c.id).sort()).toEqual(['first-poem', 'second-poem']);
  });
});

describe('render', () => {
  it('writes candidates under work/, never under the public library', () => {
    const candidates = path.join(root, 'work', 'candidates', 'tiny');
    expect(fs.readdirSync(candidates).filter((f) => f.endsWith('.webm'))).toHaveLength(2);
    expect(fs.existsSync(path.join(root, 'apps', 'listener', 'public', 'library'))).toBe(false);
  });

  it('records every track as a candidate with provenance', () => {
    const records = store();
    expect(records.tracks).toHaveLength(2);
    expect(records.tracks.every((t) => t.status === 'candidate')).toBe(true);
    for (const track of records.tracks) {
      const provenance = records.provenance.find((p) => p.trackId === track.id);
      expect(provenance?.adapter).toBe('synth');
      expect(provenance?.promptHash).toMatch(/^[a-f0-9]{64}$/);
      expect(provenance?.verdict).toBeUndefined();
    }
  });

  it('skips work that is already done', async () => {
    const message = await render({ root, formats: ['opus'] });
    expect(message).toMatch(/rendered 0, skipped 2/);
  }, 60_000);
});

describe('the human gate', () => {
  it('refuses to publish a candidate nobody approved', async () => {
    await expect(publish({ root })).rejects.toThrow(/nothing was publishable/);
  });

  it('refuses to publish an auto-approval unless told to', async () => {
    autoApprove({ root, reviewer: 'test' });
    expect(store().tracks.every((t) => t.status === 'approved')).toBe(true);
    await expect(publish({ root })).rejects.toThrow(/nothing was publishable/);
  });

  it('records a rejection with its reason and keeps the track out', () => {
    const id = 'second-poem--hymn-alto';
    recordVerdict({ root, trackId: id, verdict: 'reject', reviewer: 'jakes', reason: 'style-off' });
    const records = store();
    expect(records.tracks.find((t) => t.id === id)?.status).toBe('rejected');
    const provenance = records.provenance.find((p) => p.trackId === id);
    expect(provenance?.reason).toBe('style-off');
    expect(provenance?.reviewer).toBe('jakes');
  });

  it('insists on a reason for a rejection', () => {
    expect(() =>
      recordVerdict({
        root,
        trackId: 'first-poem--hymn-alto',
        verdict: 'reject',
        reviewer: 'jakes',
      }),
    ).toThrow(/needs a reason/);
  });
});

describe('publish and verify', () => {
  it('publishes only what a person approved', async () => {
    recordVerdict({
      root,
      trackId: 'first-poem--hymn-alto',
      verdict: 'approve',
      reviewer: 'jakes',
    });
    const message = await publish({ root });
    expect(message).toMatch(/published 1 file/);

    const cataloguePath = path.join(
      root,
      'apps/listener/public/library/tiny/catalogue.json',
    );
    const catalogue = CatalogueSchema.parse(JSON.parse(fs.readFileSync(cataloguePath, 'utf8')));
    expect(catalogue.tracks).toHaveLength(1);
    expect(catalogue.tracks[0]!.id).toBe('first-poem--hymn-alto');
    expect(catalogue.chunks.map((c) => c.id)).toEqual(['first-poem']);
    await expect(verifyCatalogue(catalogue)).resolves.toBe(true);
  }, 60_000);

  it('serves audio from the public library, not from work/', async () => {
    const catalogue = CatalogueSchema.parse(
      JSON.parse(
        fs.readFileSync(path.join(root, 'apps/listener/public/library/tiny/catalogue.json'), 'utf8'),
      ),
    );
    for (const source of catalogue.tracks[0]!.sources) {
      expect(source.path.startsWith('library/')).toBe(true);
      expect(source.path).not.toMatch(/work/);
      expect(fs.existsSync(path.join(root, 'apps/listener/public', source.path))).toBe(true);
    }
  });

  it('passes verification', async () => {
    await expect(verify({ root })).resolves.toMatch(/verified 1 tracks/);
  });

  it('can be run twice without breaking', async () => {
    await expect(publish({ root })).resolves.toMatch(/published/);
    await expect(verify({ root })).resolves.toMatch(/verified 1 tracks/);
  }, 60_000);

  it('catches a tampered audio file', async () => {
    const catalogue = CatalogueSchema.parse(
      JSON.parse(
        fs.readFileSync(path.join(root, 'apps/listener/public/library/tiny/catalogue.json'), 'utf8'),
      ),
    );
    const audio = path.join(root, 'apps/listener/public', catalogue.tracks[0]!.sources[0]!.path);
    const original = fs.readFileSync(audio);
    fs.appendFileSync(audio, 'tampered');
    await expect(verify({ root })).rejects.toThrow(/hash does not match|bytes/);
    fs.writeFileSync(audio, original);
    await expect(verify({ root })).resolves.toMatch(/verified/);
  });

  it('catches an orphaned file left in the library', async () => {
    const orphan = path.join(root, 'apps/listener/public/library/tiny/orphan.webm');
    fs.writeFileSync(orphan, 'not in any catalogue');
    await expect(verify({ root })).rejects.toThrow(/orphan/);
    fs.unlinkSync(orphan);
  });
});
