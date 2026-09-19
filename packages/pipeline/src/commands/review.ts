import fs from 'node:fs';
import path from 'node:path';
import type { RejectReason } from '@refrain/catalogue';
import { resolvePaths } from '../paths.js';
import { JsonStore, upsertProvenance } from '../store.js';
import type { CheckReport } from '../checks/autochecks.js';

export interface ReviewOptions {
  root?: string;
  trackId: string;
  verdict: 'approve' | 'reject';
  reviewer: string;
  reason?: RejectReason;
  notes?: string;
}

/**
 * Record a human verdict. Principle 3: nothing is published without one, and a
 * rejection keeps its reason so the prompt or the seed can be changed on the
 * next pass rather than re-rolled blindly.
 */
export function recordVerdict(options: ReviewOptions): string {
  const paths = resolvePaths(options.root);
  const store = new JsonStore(paths.store);
  const records = store.read();
  const track = records.tracks.find((t) => t.id === options.trackId);
  if (!track) throw new Error(`no track ${options.trackId}`);
  if (options.verdict === 'reject' && !options.reason) {
    throw new Error('a rejection needs a reason: wrong-words, bad-audio, style-off, timing-off or other');
  }

  store.update((r) => {
    const t = r.tracks.find((x) => x.id === options.trackId)!;
    t.status = options.verdict === 'approve' ? 'approved' : 'rejected';
    upsertProvenance(r.provenance, {
      ...(r.provenance.find((p) => p.trackId === options.trackId) ?? {
        trackId: options.trackId,
        adapter: 'unknown',
        promptHash: '0'.repeat(64),
        seed: 0,
        renderedAt: new Date().toISOString(),
      }),
      trackId: options.trackId,
      verdict: options.verdict,
      ...(options.reason ? { reason: options.reason } : {}),
      reviewer: options.reviewer,
      reviewedAt: new Date().toISOString(),
      ...(options.notes ? { notes: options.notes } : {}),
    });
  });

  return `${options.trackId}: ${options.verdict}${options.reason ? ` (${options.reason})` : ''} by ${options.reviewer}`;
}

export interface AutoApproveOptions {
  root?: string;
  corpus?: string;
  /** Recorded as the reviewer so an auto-approved track is never mistaken for a reviewed one. */
  reviewer?: string;
}

/**
 * Approve every candidate whose auto checks passed.
 *
 * This exists so the placeholder pilot and CI can run end to end without a
 * person in the loop. It marks the reviewer as `auto:<name>`, and `publish`
 * refuses auto-approved tracks unless explicitly told otherwise — so the human
 * gate is bypassed only on purpose, and visibly.
 */
export function autoApprove(options: AutoApproveOptions = {}): string {
  const paths = resolvePaths(options.root);
  const store = new JsonStore(paths.store);
  const reviewer = `auto:${options.reviewer ?? 'checks'}`;
  let approved = 0;
  let held = 0;

  store.update((r) => {
    for (const track of r.tracks) {
      if (track.status !== 'candidate') continue;
      const chunk = r.chunks.find((c) => c.id === track.chunkId);
      if (options.corpus && chunk?.corpusId !== options.corpus) continue;
      const report = readReport(paths.candidates, chunk?.corpusId ?? '', track.id);
      if (!report || !report.passed) {
        held++;
        continue;
      }
      track.status = 'approved';
      upsertProvenance(r.provenance, {
        ...(r.provenance.find((p) => p.trackId === track.id) ?? {
          trackId: track.id,
          adapter: 'unknown',
          promptHash: '0'.repeat(64),
          seed: 0,
          renderedAt: new Date().toISOString(),
        }),
        trackId: track.id,
        verdict: 'approve',
        reviewer,
        reviewedAt: new Date().toISOString(),
      });
      approved++;
    }
  });

  return `auto-approved ${approved}, held back ${held} that did not pass their checks`;
}

export function readReport(
  candidatesDir: string,
  corpusId: string,
  id: string,
): CheckReport | null {
  const file = path.join(candidatesDir, corpusId, `${id}.checks.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as CheckReport;
}
