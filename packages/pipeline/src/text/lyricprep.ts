import { diffWords, syllablesInLine, tokenise } from './words.js';

/**
 * Lyric prep and its gate.
 *
 * Sung renders want lines of a workable length; the canonical text does not
 * always give them. Prep may re-break lines, but it may not change the words.
 * `prepareLyrics` enforces that itself: the output is compared, word for word,
 * against the input, and any difference is an error rather than a warning.
 *
 * The spec names an LLM for this step. The gate is the part that matters and
 * it is model-independent, so the default here is a deterministic re-breaker
 * and an LLM can be dropped in behind the same check.
 */

export interface LyricPrepOptions {
  /** Aim for lines of about this many syllables. */
  targetSyllables?: number;
  /** Never emit a line longer than this. */
  maxSyllables?: number;
}

export class LyricPrepError extends Error {
  constructor(
    message: string,
    readonly detail: ReturnType<typeof diffWords>,
  ) {
    super(message);
  }
}

export function prepareLyrics(lines: string[], options: LyricPrepOptions = {}): string[] {
  const target = options.targetSyllables ?? 8;
  const max = options.maxSyllables ?? 12;
  const out: string[] = [];

  for (const line of lines) {
    const count = syllablesInLine(line);
    if (count <= max) {
      out.push(line.trim());
      continue;
    }
    out.push(...breakLine(line, target));
  }

  const result = out.filter((l) => l.length > 0);
  assertSameWords(lines, result);
  return result;
}

/** Split one over-long line at a word boundary near the target length. */
function breakLine(line: string, target: number): string[] {
  const words = line.trim().split(/\s+/);
  const pieces: string[] = [];
  let current: string[] = [];
  let count = 0;
  for (const word of words) {
    const wordSyllables = syllablesInLine(word) || 1;
    if (current.length > 0 && count + wordSyllables > target) {
      pieces.push(current.join(' '));
      current = [];
      count = 0;
    }
    current.push(word);
    count += wordSyllables;
  }
  if (current.length > 0) pieces.push(current.join(' '));
  return pieces;
}

/**
 * The gate. Throws with the actual differences attached, so a failure in CI
 * names the words that moved instead of just failing.
 */
export function assertSameWords(before: string[], after: string[]): void {
  const expected = tokenise(before.join('\n'));
  const actual = tokenise(after.join('\n'));
  const detail = diffWords(expected, actual);
  if (detail.distance !== 0) {
    throw new LyricPrepError(
      `lyric prep changed the words: ${describe(detail)}. The script is canonical; prep may only re-break lines.`,
      detail,
    );
  }
}

function describe(detail: ReturnType<typeof diffWords>): string {
  const parts: string[] = [];
  if (detail.deleted.length) parts.push(`dropped ${detail.deleted.slice(0, 5).join(', ')}`);
  if (detail.inserted.length) parts.push(`added ${detail.inserted.slice(0, 5).join(', ')}`);
  if (detail.substituted.length) {
    parts.push(
      `changed ${detail.substituted
        .slice(0, 5)
        .map(([a, b]) => `${a}→${b}`)
        .join(', ')}`,
    );
  }
  return parts.join('; ') || `${detail.distance} edits`;
}
