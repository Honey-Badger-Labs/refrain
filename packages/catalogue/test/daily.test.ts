import { describe, expect, it } from 'vitest';
import { chunkOfTheDay, dailyIndex, localDateIso } from '../src/daily.js';
import { makeCatalogue } from './fixtures.js';

describe('song of the day', () => {
  const catalogue = makeCatalogue();

  it('is the same every time for one date', () => {
    const a = chunkOfTheDay(catalogue, '2026-09-19');
    const b = chunkOfTheDay(catalogue, '2026-09-19');
    expect(a?.id).toBe(b?.id);
  });

  it('moves over a run of days', () => {
    const picks = new Set(
      Array.from({ length: 30 }, (_, i) => chunkOfTheDay(catalogue, `2026-09-${i + 1}`)?.id),
    );
    expect(picks.size).toBeGreaterThan(1);
  });

  it('reshuffles when the catalogue changes', () => {
    const other = makeCatalogue({ contentHash: 'b'.repeat(64) });
    const days = Array.from({ length: 20 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
    const differs = days.some((d) => chunkOfTheDay(catalogue, d)?.id !== chunkOfTheDay(other, d)?.id);
    expect(differs).toBe(true);
  });

  it('spreads over a two-item catalogue for different salts', () => {
    // Regression: plain FNV-1a with the salt appended left the low bit almost
    // untouched, so every salt produced an identical day-by-day sequence.
    const days = Array.from({ length: 32 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
    const left = days.map((d) => dailyIndex(d, 'a'.repeat(64), 2)).join('');
    const right = days.map((d) => dailyIndex(d, 'b'.repeat(64), 2)).join('');
    expect(left).not.toBe(right);
  });

  it('is roughly uniform across a realistic catalogue size', () => {
    const counts = new Array(150).fill(0);
    for (let i = 0; i < 15_000; i++) {
      counts[dailyIndex(`day-${i}`, 'salt', 150)]!++;
    }
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    expect(min).toBeGreaterThan(50);
    expect(max).toBeLessThan(160);
  });

  it('stays inside the array', () => {
    for (let i = 0; i < 500; i++) {
      const index = dailyIndex(`2026-01-${i}`, 'salt', 7);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(7);
    }
  });

  it('formats a local date', () => {
    expect(localDateIso(new Date(2026, 8, 19, 23, 30))).toBe('2026-09-19');
    expect(localDateIso(new Date(2026, 0, 1))).toBe('2026-01-01');
  });
});
