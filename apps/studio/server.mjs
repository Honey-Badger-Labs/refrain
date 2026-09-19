#!/usr/bin/env node
/**
 * The studio's local API.
 *
 * Deliberately small and deliberately private: it binds to 127.0.0.1, serves
 * candidate audio that must never be public (SEC-6), and writes reviewer
 * verdicts through the same code path the CLI uses. It is not a deployment
 * target — `npm run studio` runs it on a reviewer's own machine.
 *
 * In production this is where Supabase would sit, with Row Level Security and
 * reviewer accounts (SEC-5). The interface is the same either way: a queue of
 * candidates in, a verdict out.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolvePaths, JsonStore, recordVerdict, readReport } = require('@refrain/pipeline');

const paths = resolvePaths();
const PORT = Number(process.env.REFRAIN_STUDIO_PORT ?? 5174);
const HOST = '127.0.0.1';

const MIME = {
  '.webm': 'audio/webm',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
};

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${HOST}:${PORT}`);

  // The Vite dev server is a different origin. Both spellings of localhost are
  // allowed because a browser will use whichever one is in the address bar,
  // and nothing else is: this is an allowlist, not a wildcard.
  const allowed = new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`,
  ]);
  const origin = request.headers.origin;
  if (origin && allowed.has(origin)) response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Headers', 'content-type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (request.method === 'OPTIONS') return end(response, 204, '');

  try {
    if (url.pathname === '/api/queue') return json(response, queue());
    if (url.pathname === '/api/verdict' && request.method === 'POST') {
      const body = await readBody(request);
      const message = recordVerdict({
        trackId: body.trackId,
        verdict: body.verdict,
        reviewer: body.reviewer || 'reviewer',
        reason: body.reason,
        notes: body.notes,
      });
      return json(response, { ok: true, message });
    }
    if (url.pathname.startsWith('/audio/')) return audio(url.pathname, request, response);
    return end(response, 404, 'not found');
  } catch (error) {
    return json(response, { ok: false, error: String(error?.message ?? error) }, 400);
  }
});

function queue() {
  const records = new JsonStore(paths.store).read();
  const chunks = new Map(records.chunks.map((c) => [c.id, c]));
  const presets = new Map(records.presets.map((p) => [p.id, p]));
  const styles = new Map(records.styles.map((s) => [s.id, s]));
  const voices = new Map(records.voices.map((v) => [v.id, v]));

  const items = records.tracks.map((track) => {
    const chunk = chunks.get(track.chunkId);
    const preset = presets.get(track.presetId);
    const provenance = records.provenance.find((p) => p.trackId === track.id) ?? null;
    const report = chunk ? readReport(paths.candidates, chunk.corpusId, track.id) : null;
    const extension = path.extname(track.sources?.[0]?.path ?? '.webm');
    return {
      id: track.id,
      status: track.status,
      durationSeconds: track.durationSeconds,
      chunk: chunk
        ? { id: chunk.id, title: chunk.title, lines: chunk.lines, corpusId: chunk.corpusId }
        : null,
      preset: preset
        ? {
            id: preset.id,
            style: styles.get(preset.styleId)?.name ?? preset.styleId,
            voice: voices.get(preset.voiceId)?.name ?? preset.voiceId,
          }
        : null,
      audio: chunk ? `/audio/${chunk.corpusId}/${track.id}${extension}` : null,
      report,
      provenance,
    };
  });

  return {
    items,
    counts: items.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

function audio(pathname, request, response) {
  const parts = pathname.split('/').filter(Boolean).slice(1);
  if (parts.length !== 2) return end(response, 400, 'bad path');
  const [corpusId, name] = parts;
  // Resolve, then check containment: no request may escape the candidates dir.
  const file = path.resolve(paths.candidates, corpusId, name);
  if (!file.startsWith(path.resolve(paths.candidates) + path.sep)) {
    return end(response, 403, 'outside the candidates directory');
  }
  if (!fs.existsSync(file)) return end(response, 404, 'no such candidate');

  const stat = fs.statSync(file);
  const type = MIME[path.extname(file)] ?? 'application/octet-stream';
  const range = request.headers.range;
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = Number(match?.[1] ?? 0);
    const end_ = match?.[2] ? Number(match[2]) : stat.size - 1;
    response.writeHead(206, {
      'content-type': type,
      'content-range': `bytes ${start}-${end_}/${stat.size}`,
      'accept-ranges': 'bytes',
      'content-length': end_ - start + 1,
    });
    return fs.createReadStream(file, { start, end: end_ }).pipe(response);
  }
  response.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    'accept-ranges': 'bytes',
  });
  return fs.createReadStream(file).pipe(response);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function json(response, body, status = 200) {
  const text = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(text);
}

function end(response, status, text) {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(text);
}

server.listen(PORT, HOST, () => {
  console.log(`Refrain studio API on http://${HOST}:${PORT} — local only, never deploy this.`);
});
