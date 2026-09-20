import fs from 'node:fs';
import path from 'node:path';
import { resolvePaths } from '../paths.js';
import { registerAdapter } from './types.js';
import { createHttpAdapter, validateProviderConfig, type ProviderConfig } from './http.js';

/**
 * Provider configs live in `content/providers/*.json`, beside the corpora, so
 * the set of contenders in a bake-off is visible in the repository and in a
 * diff. Keys never are: a config names the environment variable, and the
 * loader refuses a config whose value looks like a key rather than a variable
 * name.
 */

export interface LoadedProvider {
  config: ProviderConfig;
  file: string;
  /** False when its key is not in the environment: it can be listed, not run. */
  ready: boolean;
}

export function providersDir(root?: string): string {
  return path.join(resolvePaths(root).content, 'providers');
}

export function loadProviders(root?: string): LoadedProvider[] {
  const dir = providersDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.example.json'))
    .sort()
    .map((file) => {
      const full = path.join(dir, file);
      const config = validateProviderConfig(
        JSON.parse(fs.readFileSync(full, 'utf8')),
        path.relative(process.cwd(), full),
      );
      return { config, file: full, ready: Boolean(process.env[config.apiKeyEnv]) };
    });
}

/** Register every configured provider as a render adapter. */
export function registerProviders(root?: string, workDir?: string): LoadedProvider[] {
  const paths = resolvePaths(root);
  const providers = loadProviders(root);
  for (const provider of providers) {
    registerAdapter(
      createHttpAdapter(provider.config, { workDir: workDir ?? path.join(paths.work, 'tmp') }),
    );
  }
  return providers;
}
