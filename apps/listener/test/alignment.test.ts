import { describe, expect, it } from 'vitest';
import { lineAt, mapPosition, spanForLine } from '../src/player/alignment.js';

const alignment = [
  { lineIndex: 0, start: 1, end: 3 },
  { lineIndex: 1, start: 3, end: 5.5 },
  { lineIndex: 2, start: 6, end: 9 },
];

describe('lineAt', () => {
  it.each([
    [0, -1],
    [0.9, -1],
    [1, 0],
    [2.9, 0],
    [3, 1],
    [5.4, 1],
    [5.7, -1],
    [6, 2],
    [8.9, 2],
    [9, -1],
    [100, -1],
  ])('at %ss the active line is %i', (time, expected) => {
    expect(lineAt(alignment, time)).toBe(expected);
  });

  it('returns -1 for an empty alignment', () => {
    expect(lineAt([], 4)).toBe(-1);
  });

  it('agrees with a linear scan over a long alignment', () => {
    const long = Array.from({ length: 500 }, (_, i) => ({
      lineIndex: i,
      start: i * 2,
      end: i * 2 + 1.5,
    }));
    for (let t = 0; t < 1000; t += 0.37) {
      const scan = long.find((s) => t >= s.start && t < s.end)?.lineIndex ?? -1;
      expect(lineAt(long, t)).toBe(scan);
    }
  });
});

describe('spanForLine', () => {
  it('finds a span', () => {
    expect(spanForLine(alignment, 1)?.start).toBe(3);
  });

  it('returns null for a line with no span', () => {
    expect(spanForLine(alignment, 9)).toBeNull();
  });
});

describe('mapPosition', () => {
  const slower = [
    { lineIndex: 0, start: 2, end: 6 },
    { lineIndex: 1, start: 6, end: 11 },
    { lineIndex: 2, start: 12, end: 18 },
  ];

  it('lands on the same line when switching take', () => {
    // Halfway through line 1 in the faster take.
    const mapped = mapPosition(alignment, slower, 4.25, 10, 20);
    expect(lineAt(slower, mapped)).toBe(1);
  });

  it('keeps roughly the same place within the line', () => {
    const mapped = mapPosition(alignment, slower, 4.25, 10, 20);
    expect(mapped).toBeCloseTo(8.5, 1);
  });

  it('falls back to a proportional position between lines', () => {
    const mapped = mapPosition(alignment, slower, 5.75, 10, 20);
    expect(mapped).toBeCloseTo(11.5, 1);
  });

  it('never returns a position past the end of the other take', () => {
    expect(mapPosition(alignment, slower, 9999, 10, 20)).toBeLessThanOrEqual(20);
    expect(mapPosition(alignment, slower, -5, 10, 20)).toBeGreaterThanOrEqual(0);
  });

  it('copes with a take that has no alignment at all', () => {
    expect(mapPosition([], slower, 5, 10, 20)).toBeCloseTo(10);
    expect(mapPosition(alignment, [], 5, 10, 20)).toBeCloseTo(10);
  });

  it('returns 0 rather than NaN when the source duration is unknown', () => {
    expect(mapPosition([], [], 5, 0, 20)).toBe(0);
  });
});
