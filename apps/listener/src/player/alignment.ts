import type { AlignmentSpan, TokenSpan } from '@refrain/catalogue';

/** Anything with a start and an end in seconds. */
interface Span {
  start: number;
  end: number;
}

/**
 * Where in the list the span sounding at time t sits, or -1.
 *
 * Called on every timeupdate, so it is a binary search rather than a scan: a
 * 600-token chunk costs ten comparisons instead of six hundred. Returns -1
 * before the first span and between spans, so a view can show its tokens
 * un-highlighted during an instrumental passage instead of leaving the last
 * one lit.
 *
 * It answers with a position rather than a token number because the two
 * span shapes spell their token number differently — `lineIndex` on the wire,
 * `index` everywhere else — and neither should need its own search.
 */
function positionAt(spans: readonly Span[], time: number): number {
  let low = 0;
  let high = spans.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const span = spans[mid]!;
    if (time < span.start) high = mid - 1;
    else if (time >= span.end) low = mid + 1;
    else return mid;
  }
  return -1;
}

/** Which line is sounding at time t. */
export function lineAt(alignment: readonly AlignmentSpan[], time: number): number {
  const at = positionAt(alignment, time);
  return at === -1 ? -1 : alignment[at]!.lineIndex;
}

/** Which token is sounding at time t, for any kind of performance. */
export function tokenAt(spans: readonly TokenSpan[], time: number): number {
  const at = positionAt(spans, time);
  return at === -1 ? -1 : spans[at]!.index;
}

/** The span for a line, for seeking when a listener taps the text. */
export function spanForLine(
  alignment: readonly AlignmentSpan[],
  lineIndex: number,
): AlignmentSpan | null {
  return alignment.find((s) => s.lineIndex === lineIndex) ?? null;
}

/** The span for a token, for seeking when a learner taps one. */
export function spanForToken(spans: readonly TokenSpan[], index: number): TokenSpan | null {
  return spans.find((s) => s.index === index) ?? null;
}

/**
 * Where the same moment sits in another take.
 *
 * Switching style or voice mid-listen should not throw the listener back to
 * the start. Two renders of one chunk share their tokens but not their
 * timings, so the position is carried across by token and by how far through
 * that token the listener had got.
 */
function mapBy<T extends Span>(
  from: readonly T[],
  to: readonly T[],
  time: number,
  fromDuration: number,
  toDuration: number,
  numberOf: (span: T) => number,
): number {
  const proportional = () => {
    if (fromDuration <= 0) return 0;
    return clamp((time / fromDuration) * toDuration, 0, toDuration);
  };
  if (from.length === 0 || to.length === 0) return proportional();

  const at = positionAt(from, time);
  if (at === -1) return proportional();

  const source = from[at]!;
  const wanted = numberOf(source);
  const target = to.find((s) => numberOf(s) === wanted);
  if (!target) return 0;

  const progress =
    source.end > source.start ? (time - source.start) / (source.end - source.start) : 0;
  return clamp(target.start + progress * (target.end - target.start), 0, toDuration);
}

export function mapPosition(
  from: readonly AlignmentSpan[],
  to: readonly AlignmentSpan[],
  time: number,
  fromDuration: number,
  toDuration: number,
): number {
  return mapBy(from, to, time, fromDuration, toDuration, (s) => s.lineIndex);
}

export function mapTokenPosition(
  from: readonly TokenSpan[],
  to: readonly TokenSpan[],
  time: number,
  fromDuration: number,
  toDuration: number,
): number {
  return mapBy(from, to, time, fromDuration, toDuration, (s) => s.index);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
