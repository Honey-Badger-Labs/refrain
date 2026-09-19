import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The service worker is hand-written and lives in `public/`, so Vite copies it
 * verbatim. That leaves one thing to do at build time: give it a cache name
 * that changes whenever the build does. Versioned cache names are how SEC-10
 * is met — a new deploy cannot serve a stale shell out of an old cache.
 */
function stampServiceWorker(): Plugin {
  return {
    name: 'refrain-stamp-service-worker',
    apply: 'build',
    closeBundle() {
      const outDir = path.resolve(import.meta.dirname, 'dist');
      const swPath = path.join(outDir, 'sw.js');
      if (!fs.existsSync(swPath)) return;

      const hash = createHash('sha256');
      for (const file of walk(path.join(outDir, 'assets')).sort()) {
        hash.update(path.relative(outDir, file));
        hash.update(fs.readFileSync(file));
      }
      const indexPath = path.join(outDir, 'index.html');
      if (fs.existsSync(indexPath)) hash.update(fs.readFileSync(indexPath));
      const buildId = hash.digest('hex').slice(0, 12);

      const shell = ['index.html', 'manifest.webmanifest', 'icon.svg']
        .filter((f) => fs.existsSync(path.join(outDir, f)))
        .concat(
          walk(path.join(outDir, 'assets')).map((f) =>
            path.relative(outDir, f).split(path.sep).join('/'),
          ),
        );

      const source = fs
        .readFileSync(swPath, 'utf8')
        .replace('__BUILD_ID__', buildId)
        .replace('"__SHELL__"', JSON.stringify(shell));
      fs.writeFileSync(swPath, source);
      this.warn?.(`service worker stamped with build ${buildId} and ${shell.length} shell files`);
    },
  };
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

// GitHub Pages serves the site from /<repo>/, so the base has to match. Set
// REFRAIN_BASE=/ for a root deploy or a local preview.
const base = process.env.REFRAIN_BASE ?? '/refrain/';

export default defineConfig({
  base,
  plugins: [react(), stampServiceWorker()],
  build: {
    target: 'es2020',
    sourcemap: true,
    // Audio is copied in from the pipeline; it must not be inlined or hashed.
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
  },
});
