/**
 * Word handling shared by the lyric-prep gate and the accuracy check.
 *
 * Both need the same question answered: are these two pieces of text the same
 * words in the same order? Punctuation, case and line breaks are noise for
 * that question; the words are not.
 */

export function tokenise(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .replace(/(^|\s)'+|'+(\s|$)/g, '$1$2')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * The word as it is sung, rather than as it was printed in 1794.
 *
 * An apostrophe in "charter'd" stands for the elided e and is sung exactly as
 * "chartered"; "tyger" is the spelling of a word pronounced "tiger". A
 * transcriber writes down what it hears, in modern spelling, so comparing the
 * page to the transcript marks a faithful performance wrong — and the check
 * that does so is the gate deciding whether a render is publishable.
 *
 * This normalises both sides of that comparison. It never touches the text
 * itself: the corpus keeps Blake's spelling, invariant 3 is untouched, and
 * what changes is only how two pieces of text are judged the same.
 */
export function sungForm(word: string): string {
  return word
    .replace(/^tyger$/, 'tiger')
    .replace(/'d$/, 'ed')
    .replace(/'ning$/, 'ening')
    .replace(/'st$/, 'est')
    .replace(/^thro'?$/, 'through')
    .replace(/'s$/, 's')
    .replace(/'/g, '');
}

/** Two words that differ only in how the century spelled them. */
export function sameWhenSung(a: string, b: string): boolean {
  return a !== b && sungForm(a) === sungForm(b);
}

export interface WordDiff {
  /** 1 means every word matched in order. */
  accuracy: number;
  inserted: string[];
  deleted: string[];
  substituted: Array<[string, string]>;
  distance: number;
}

/**
 * Word-level Levenshtein with backtracking, so a failed check can say which
 * words went missing rather than only that something did. Accuracy is
 * 1 - distance / expected-length, floored at 0, which is the usual word error
 * rate read the friendly way round.
 */
export function diffWords(expected: string[], actual: string[]): WordDiff {
  const n = expected.length;
  const m = actual.length;
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i]![0] = i;
  for (let j = 0; j <= m; j++) d[0]![j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = expected[i - 1] === actual[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
    }
  }

  const inserted: string[] = [];
  const deleted: string[] = [];
  const substituted: Array<[string, string]> = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const cost = expected[i - 1] === actual[j - 1] ? 0 : 1;
      if (d[i]![j] === d[i - 1]![j - 1]! + cost) {
        if (cost === 1) substituted.push([expected[i - 1]!, actual[j - 1]!]);
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && d[i]![j] === d[i - 1]![j]! + 1) {
      deleted.push(expected[i - 1]!);
      i--;
      continue;
    }
    inserted.push(actual[j - 1]!);
    j--;
  }

  const distance = d[n]![m]!;
  const accuracy = n === 0 ? (m === 0 ? 1 : 0) : Math.max(0, 1 - distance / n);
  return {
    accuracy,
    distance,
    inserted: inserted.reverse(),
    deleted: deleted.reverse(),
    substituted: substituted.reverse(),
  };
}

const VOWEL_GROUP = /[aeiouy]+/g;

/**
 * Syllable estimate.
 *
 * Deliberately a heuristic, not a dictionary: it only has to decide how many
 * notes a line gets. Counts vowel groups, drops a silent trailing `e`, and
 * never returns less than one.
 */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;
  let count = (w.match(VOWEL_GROUP) ?? []).length;
  if (/[^aeiouy]e$/.test(w) && count > 1) count -= 1;
  if (/(?:[^aeiouy]le|[^aeiouy]les)$/.test(w)) count += 1;
  return Math.max(1, count);
}

export function syllablesInLine(line: string): number {
  return tokenise(line).reduce((sum, word) => sum + syllables(word), 0);
}
