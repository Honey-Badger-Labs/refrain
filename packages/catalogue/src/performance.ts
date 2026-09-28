import type { AlignmentSpan, Performance, Track, TokenKind, TokenSpan } from './schema.js';

/**
 * The words of a track, as a performance.
 *
 * `Track.alignment` predates `Performance` and is the `line` kind wearing an
 * older name — see `AlignmentSpanSchema` for why the name stays. Everything
 * downstream should ask for a performance and stop caring which spelling it
 * came from, so this is the only place that knows.
 *
 * The result is derived, not stored: calling it per timeupdate would allocate
 * an array sixty times a second. Call it once when a track loads.
 */
export function asTokenSpans(alignment: readonly AlignmentSpan[]): TokenSpan[] {
  return alignment.map((span) => ({
    index: span.lineIndex,
    start: span.start,
    end: span.end,
  }));
}

export function linePerformance(track: Track, lines: readonly string[]): Performance {
  return {
    kind: 'line',
    tokens: [...lines],
    spans: asTokenSpans(track.alignment),
  };
}

/**
 * Every stream this track can be followed by, words first.
 *
 * A listener draws the `line` one. A practice view looks for `note` or `chord`
 * and falls back to the words when the render did not carry one, which is what
 * every track in the pilot library does.
 */
export function performancesOf(track: Track, lines: readonly string[]): Performance[] {
  return [linePerformance(track, lines), ...(track.performances ?? [])];
}

export function performanceOf(
  track: Track,
  kind: TokenKind,
  lines: readonly string[],
): Performance | null {
  return performancesOf(track, lines).find((p) => p.kind === kind) ?? null;
}
