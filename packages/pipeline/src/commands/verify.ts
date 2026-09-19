import fs from 'node:fs';
import path from 'node:path';
import {
  CatalogueIndexSchema,
  CatalogueSchema,
  sha256Hex,
  verifyCatalogue,
} from '@refrain/catalogue';
import { resolvePaths } from '../paths.js';

/**
 * Verify the published library.
 *
 * CI runs this on every push. It is the mechanical half of the release gate:
 * the catalogue parses, its hash matches its own contents, every track's audio
 * exists at the path the catalogue gives and hashes to the value it records,
 * and no file in the library is unreferenced.
 */
export async function verify(options: { root?: string } = {}): Promise<string> {
  const paths = resolvePaths(options.root);
  const indexPath = path.join(paths.published, 'index.json');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`no published library at ${paths.published}; run \`refrain publish\` first`);
  }

  const index = CatalogueIndexSchema.parse(JSON.parse(fs.readFileSync(indexPath, 'utf8')));
  const problems: string[] = [];
  const referenced = new Set<string>();
  let tracks = 0;

  for (const entry of index.corpora) {
    const cataloguePath = path.join(paths.published, '..', entry.path);
    if (!fs.existsSync(cataloguePath)) {
      problems.push(`${entry.id}: catalogue missing at ${entry.path}`);
      continue;
    }
    const parsed = CatalogueSchema.safeParse(JSON.parse(fs.readFileSync(cataloguePath, 'utf8')));
    if (!parsed.success) {
      problems.push(`${entry.id}: catalogue does not match the schema — ${parsed.error.issues[0]?.message}`);
      continue;
    }
    const catalogue = parsed.data;
    if (!(await verifyCatalogue(catalogue))) {
      problems.push(`${entry.id}: contentHash does not match the catalogue's own contents`);
    }
    if (catalogue.tracks.length !== entry.trackCount) {
      problems.push(`${entry.id}: index says ${entry.trackCount} tracks, catalogue has ${catalogue.tracks.length}`);
    }

    for (const track of catalogue.tracks) {
      tracks++;
      for (const source of track.sources) {
        const audio = path.join(paths.published, '..', source.path);
        if (!fs.existsSync(audio)) {
          problems.push(`${track.id}: ${source.codec} audio missing at ${source.path}`);
          continue;
        }
        referenced.add(path.resolve(audio));
        const digest = await sha256Hex(new Uint8Array(fs.readFileSync(audio)));
        if (digest !== source.sha256) {
          problems.push(`${track.id}: ${source.codec} audio hash does not match the catalogue`);
        }
        const size = fs.statSync(audio).size;
        if (size !== source.bytes) {
          problems.push(
            `${track.id}: catalogue says ${source.bytes} bytes for ${source.codec}, file is ${size}`,
          );
        }
      }
    }
  }

  for (const file of walk(paths.published)) {
    // Catalogues and the generated share pages are not audio; they are checked
    // above, or generated fresh on every publish.
    if (file.endsWith('.json') || file.endsWith('.html')) continue;
    if (!referenced.has(path.resolve(file))) {
      problems.push(`orphan: ${path.relative(paths.root, file)} is not in any catalogue`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`published library failed verification:\n  - ${problems.join('\n  - ')}`);
  }
  return `verified ${tracks} tracks across ${index.corpora.length} corpus/corpora`;
}

function* walk(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}
