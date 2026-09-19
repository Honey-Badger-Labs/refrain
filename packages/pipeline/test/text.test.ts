import { describe, expect, it } from 'vitest';
import { diffWords, syllables, syllablesInLine, tokenise } from '../src/text/words.js';
import { assertSameWords, LyricPrepError, prepareLyrics } from '../src/text/lyricprep.js';
import { parseSource, IngestError } from '../src/text/ingest.js';

describe('tokenise', () => {
  it('drops punctuation, case and line breaks but keeps words', () => {
    expect(tokenise("Little Lamb, who made thee?\nDost thou know?")).toEqual([
      'little',
      'lamb',
      'who',
      'made',
      'thee',
      'dost',
      'thou',
      'know',
    ]);
  });

  it('normalises curly apostrophes and keeps the contraction', () => {
    expect(tokenise('I’ll tell thee')).toEqual(["i'll", 'tell', 'thee']);
  });

  it('strips accents rather than splitting on them', () => {
    expect(tokenise('naïve café')).toEqual(['naive', 'cafe']);
  });

  it('handles an empty string', () => {
    expect(tokenise('   ')).toEqual([]);
  });
});

describe('diffWords', () => {
  it('scores identical text as perfect', () => {
    const d = diffWords(['a', 'b', 'c'], ['a', 'b', 'c']);
    expect(d.accuracy).toBe(1);
    expect(d.distance).toBe(0);
  });

  it('names a dropped word', () => {
    const d = diffWords(['tyger', 'tyger', 'burning', 'bright'], ['tyger', 'burning', 'bright']);
    expect(d.deleted).toEqual(['tyger']);
    expect(d.accuracy).toBeCloseTo(0.75);
  });

  it('names an invented word', () => {
    const d = diffWords(['burning', 'bright'], ['burning', 'so', 'bright']);
    expect(d.inserted).toEqual(['so']);
  });

  it('names a substitution', () => {
    const d = diffWords(['burning', 'bright'], ['burning', 'light']);
    expect(d.substituted).toEqual([['bright', 'light']]);
  });

  it('never reports a negative accuracy', () => {
    const d = diffWords(['one'], ['a', 'b', 'c', 'd', 'e']);
    expect(d.accuracy).toBe(0);
  });

  it('treats two empty inputs as a match', () => {
    expect(diffWords([], []).accuracy).toBe(1);
  });
});

describe('syllables', () => {
  it.each([
    ['lamb', 1],
    ['little', 2],
    ['tyger', 2],
    ['symmetry', 3],
    ['immortal', 3],
    ['the', 1],
    ['fire', 1],
  ])('%s → %i', (word, expected) => {
    expect(syllables(word)).toBe(expected);
  });

  it('counts a line', () => {
    expect(syllablesInLine('Tyger Tyger, burning bright')).toBeGreaterThanOrEqual(6);
  });
});

describe('prepareLyrics', () => {
  it('leaves short lines alone', () => {
    const lines = ['Little Lamb who made thee', 'Dost thou know who made thee'];
    expect(prepareLyrics(lines)).toEqual(lines);
  });

  it('breaks a long line at a word boundary without changing a word', () => {
    const long = [
      'When the voices of children are heard on the green and laughing is heard on the hill',
    ];
    const out = prepareLyrics(long, { targetSyllables: 8, maxSyllables: 10 });
    expect(out.length).toBeGreaterThan(1);
    expect(out.join(' ').split(/\s+/)).toEqual(long[0]!.split(/\s+/));
  });

  it('is idempotent', () => {
    const lines = ['Tyger Tyger, burning bright', 'In the forests of the night'];
    expect(prepareLyrics(prepareLyrics(lines))).toEqual(prepareLyrics(lines));
  });
});

describe('the no-word-change gate', () => {
  it('passes when only the line breaks moved', () => {
    expect(() =>
      assertSameWords(['Tyger Tyger, burning bright'], ['Tyger Tyger,', 'burning bright']),
    ).not.toThrow();
  });

  it('catches a dropped word', () => {
    expect(() => assertSameWords(['a b c'], ['a c'])).toThrow(LyricPrepError);
    expect(() => assertSameWords(['a b c'], ['a c'])).toThrow(/dropped b/);
  });

  it('catches a helpfully modernised word', () => {
    expect(() => assertSameWords(['Dost thou know'], ['Do you know'])).toThrow(/changed/);
  });

  it('ignores punctuation and capitals, which prep may change', () => {
    expect(() => assertSameWords(['Tyger, Tyger!'], ['tyger tyger'])).not.toThrow();
  });
});

describe('parseSource', () => {
  it('reads a title and its lines', () => {
    const parsed = parseSource('The Lamb\n\nLittle Lamb who made thee\nDost thou know', 'x.txt');
    expect(parsed.title).toBe('The Lamb');
    expect(parsed.lines).toHaveLength(2);
  });

  it('handles CRLF and a byte-order mark', () => {
    const parsed = parseSource('﻿The Lamb\r\n\r\nLittle Lamb\r\n', 'x.txt');
    expect(parsed.title).toBe('The Lamb');
    expect(parsed.lines).toEqual(['Little Lamb']);
  });

  it('keeps stanzas as lines and drops the blank rows', () => {
    const parsed = parseSource('T\n\nline one\n\nline two\n', 'x.txt');
    expect(parsed.lines).toEqual(['line one', 'line two']);
  });

  it('refuses a file with no text after the title', () => {
    expect(() => parseSource('Just a title\n', 'x.txt')).toThrow(IngestError);
  });
});
