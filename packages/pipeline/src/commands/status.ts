import { resolvePaths } from '../paths.js';
import { JsonStore } from '../store.js';
import { readReport } from './review.js';

/** Where the pilot stands: the four numbers the spec asks the pilot to produce. */
export function status(options: { root?: string } = {}): string {
  const paths = resolvePaths(options.root);
  const records = new JsonStore(paths.store).read();

  const byStatus = new Map<string, number>();
  for (const track of records.tracks) {
    byStatus.set(track.status, (byStatus.get(track.status) ?? 0) + 1);
  }

  const reviewed = records.provenance.filter((p) => p.verdict);
  const byHuman = reviewed.filter((p) => p.reviewer && !p.reviewer.startsWith('auto:'));
  const approvals = byHuman.filter((p) => p.verdict === 'approve').length;
  const firstPass = byHuman.length === 0 ? null : approvals / byHuman.length;

  const accuracies = records.provenance
    .map((p) => p.wordAccuracy)
    .filter((a): a is number => typeof a === 'number');
  const meanAccuracy =
    accuracies.length === 0 ? null : accuracies.reduce((a, b) => a + b, 0) / accuracies.length;

  const totalSeconds = records.tracks
    .filter((t) => t.status === 'published')
    .reduce((sum, t) => sum + t.durationSeconds, 0);
  const totalBytes = records.tracks
    .filter((t) => t.status === 'published')
    .reduce((sum, t) => sum + t.sources.reduce((inner, s) => inner + s.bytes, 0), 0);
  const deliveredBytes = records.tracks
    .filter((t) => t.status === 'published')
    .reduce((sum, t) => sum + (t.sources[0]?.bytes ?? 0), 0);

  let checksIncomplete = 0;
  for (const track of records.tracks) {
    const chunk = records.chunks.find((c) => c.id === track.chunkId);
    const report = readReport(paths.candidates, chunk?.corpusId ?? '', track.id);
    if (report?.incomplete) checksIncomplete++;
  }

  const lines = [
    `corpora    ${records.corpora.length}`,
    `chunks     ${records.chunks.length}`,
    `presets    ${records.presets.length}`,
    `tracks     ${records.tracks.length} (${[...byStatus.entries()]
      .map(([k, v]) => `${k} ${v}`)
      .join(', ') || 'none'})`,
    `published  ${fmtDuration(totalSeconds)}, ${(totalBytes / 1024 / 1024).toFixed(1)} MB on disk, ${(deliveredBytes / 1024 / 1024).toFixed(1)} MB per listener`,
    `reviewed   ${byHuman.length} by a person, ${reviewed.length - byHuman.length} automatically`,
    `first pass ${firstPass === null ? 'not measured yet' : `${(firstPass * 100).toFixed(0)}%`}`,
    `accuracy   ${meanAccuracy === null ? 'not measured: no transcriber has listened to these renders' : `${(meanAccuracy * 100).toFixed(1)}% mean`}`,
    `checks     ${checksIncomplete} track(s) have at least one check that could not run`,
  ];
  return lines.join('\n');
}

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
}
