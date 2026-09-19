import type { AlignmentSpan } from '@refrain/catalogue';

/**
 * Which line is sounding at time t.
 *
 * Called on every timeupdate, so it is a binary search rather than a scan: a
 * 600-line chunk costs ten comparisons instead of six hundred. Returns -1
 * before the first line and between lines, so the view can show the text
 * un-highlighted during an instrumental passage instead of leaving the last
 * line lit.
 */
export function lineAt(alignment: readonly AlignmentSpan[], time: number): number {
  let low = 0;
  let high = alignment.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const span = alignment[mid]!;
    if (time < span.start) high = mid - 1;
    else if (time >= span.end) low = mid + 1;
    else return span.lineIndex;
  }
  return -1;
}

/** The span for a line, for seeking when a listener taps the text. */
export function spanForLine(
  alignment: readonly AlignmentSpan[],
  lineIndex: number,
): AlignmentSpan | null {
  return alignment.find((s) => s.lineIndex === lineIndex) ?? null;
}

/**
 * Where the same moment sits in another take.
 *
 * Switching style or voice mid-listen should not throw the listener back to
 * the start. Two renders of one chunk share their lines but not their timings,
 * so the position is carried across by line and by how far through that line
 * the listener had got.
 */
export function mapPosition(
  from: readonly AlignmentSpan[],
  to: readonly AlignmentSpan[],
  time: number,
  fromDuration: number,
  toDuration: number,
): number {
  if (from.length === 0 || to.length === 0) {
    if (fromDuration <= 0) return 0;
    return clamp((time / fromDuration) * toDuration, 0, toDuration);
  }
  const index = lineAt(from, time);
  if (index === -1) {
    if (fromDuration <= 0) return 0;
    return clamp((time / fromDuration) * toDuration, 0, toDuration);
  }
  const source = spanForLine(from, index);
  const target = spanForLine(to, index);
  if (!source || !target) return 0;
  const progress = source.end > source.start ? (time - source.start) / (source.end - source.start) : 0;
  return clamp(target.start + progress * (target.end - target.start), 0, toDuration);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
