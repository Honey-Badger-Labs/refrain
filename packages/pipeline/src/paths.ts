import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Everything the pipeline writes lives under one of four roots. Candidates are
 * separate from published output on purpose: `work/candidates` is gitignored
 * and never served, which is SEC-6 expressed as a directory layout.
 */
export interface Paths {
  root: string;
  content: string;
  work: string;
  candidates: string;
  data: string;
  store: string;
  published: string;
}

export function findRepoRoot(startDir = process.cwd()): string {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
        name?: string;
      };
      if (pkg.name === 'refrain') return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to walking up from this file, which works when the CLI is run
  // from outside the repo.
  let here = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (fs.existsSync(path.join(here, 'package.json'))) {
      const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8')) as {
        name?: string;
      };
      if (pkg.name === 'refrain') return here;
    }
    const parent = path.dirname(here);
    if (parent === here) throw new Error('cannot find the refrain repository root');
    here = parent;
  }
}

export function resolvePaths(root = findRepoRoot()): Paths {
  return {
    root,
    content: path.join(root, 'content'),
    work: path.join(root, 'work'),
    candidates: path.join(root, 'work', 'candidates'),
    data: path.join(root, 'data'),
    store: path.join(root, 'data', 'store.json'),
    published: path.join(root, 'apps', 'listener', 'public', 'library'),
  };
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
