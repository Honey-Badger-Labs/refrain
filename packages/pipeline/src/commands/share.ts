import fs from 'node:fs';
import path from 'node:path';
import type { Catalogue } from '@refrain/catalogue';
import { ensureDir } from '../paths.js';

/**
 * Share pages.
 *
 * A hash route is invisible to a crawler: every link into the app returns the
 * same `index.html`, so a shared poem previews as "Refrain" and nothing else.
 * The fix that does not need a server is one tiny page per listening state,
 * generated at publish time, carrying the real title and opening line in its
 * Open Graph tags and redirecting to the hash route.
 *
 * These pages contain no script. The redirect is a meta refresh and a plain
 * link, so nothing executes and there is nothing to inject into: every value
 * written here comes from the validated catalogue and is HTML-escaped anyway.
 */
export function writeSharePages(
  publishedRoot: string,
  catalogue: Catalogue,
  options: { appBase?: string } = {},
): number {
  const shareDir = ensureDir(path.join(publishedRoot, catalogue.corpus.id, 'share'));
  // From library/<corpus>/share/x.html back up to the app root.
  const up = '../../../';
  const appBase = options.appBase ?? up;
  const existing = new Set(fs.readdirSync(shareDir));
  let written = 0;

  for (const chunk of catalogue.chunks) {
    for (const track of catalogue.tracks.filter((t) => t.chunkId === chunk.id)) {
      const preset = catalogue.presets.find((p) => p.id === track.presetId);
      if (!preset) continue;
      const name = `${chunk.id}--${preset.id}.html`;
      const route = `#/${catalogue.corpus.id}/${preset.voiceId}/${preset.styleId}/${chunk.bookId}/${chunk.id}`;
      const style = catalogue.styles.find((s) => s.id === preset.styleId)?.name ?? preset.styleId;
      const voice = catalogue.voices.find((v) => v.id === preset.voiceId)?.name ?? preset.voiceId;
      const description = `${chunk.lines[0] ?? ''} — ${catalogue.corpus.author}, sung in ${style} with the ${voice} voice.`;

      fs.writeFileSync(
        path.join(shareDir, name),
        page({
          title: `${chunk.title} — ${catalogue.corpus.author}`,
          description,
          target: `${appBase}${route}`,
          image: `${up}icon-512.png`,
        }),
      );
      existing.delete(name);
      written++;
    }
  }

  // A chunk that was unpublished should not keep a share page pointing at it.
  for (const stale of existing) {
    if (stale.endsWith('.html')) fs.unlinkSync(path.join(shareDir, stale));
  }

  return written;
}

function page(input: { title: string; description: string; target: string; image: string }): string {
  const title = escapeHtml(input.title);
  const description = escapeHtml(input.description);
  const target = escapeHtml(input.target);
  const image = escapeHtml(input.image);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta property="og:type" content="music.song" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${image}" />
    <meta property="og:site_name" content="Refrain" />
    <meta name="twitter:card" content="summary" />
    <meta http-equiv="refresh" content="0; url=${target}" />
    <link rel="canonical" href="${target}" />
    <style>
      body { background: #0d0f18; color: #e7e9f2; font-family: system-ui, sans-serif;
             display: grid; place-items: center; min-height: 100vh; margin: 0; text-align: center; }
      a { color: #e39a2f; }
    </style>
  </head>
  <body>
    <p>${title}<br /><a href="${target}">Open in Refrain</a></p>
  </body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The share URL for a listening state, as the app builds it. */
export function sharePathFor(corpusId: string, chunkId: string, presetId: string): string {
  return `library/${corpusId}/share/${chunkId}--${presetId}.html`;
}
