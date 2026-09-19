import type { Catalogue } from './schema.js';

/**
 * Song of the day.
 *
 * Deterministic from the date alone, so every listener sees the same pick with
 * no server involved, and a shared link still works tomorrow. Salting with the
 * catalogue's content hash means a republished catalogue reshuffles instead of
 * repeating yesterday's order.
 *
 * Two details matter and both were found by a test. The salt goes *first*, so
 * it diffuses through the whole hash rather than only touching the tail. And
 * the result is avalanched before the modulo: plain FNV-1a keeps its low bits
 * almost unchanged by late input, so `h % 2` was returning the same chunk for
 * every salt.
 */
export function dailyIndex(dateIso: string, salt: string, length: number): number {
  if (length <= 0) throw new Error('length must be positive');
  let h = 0x811c9dc5;
  const input = `${salt}:${dateIso}`;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return avalanche(h) % length;
}

/** murmur3's finaliser: spreads every input bit across all 32 output bits. */
function avalanche(input: number): number {
  let h = input >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Format a Date as YYYY-MM-DD in the viewer's own timezone. */
export function localDateIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function chunkOfTheDay(
  catalogue: Catalogue,
  dateIso: string,
): Catalogue['chunks'][number] | null {
  if (catalogue.chunks.length === 0) return null;
  const index = dailyIndex(dateIso, catalogue.contentHash, catalogue.chunks.length);
  return catalogue.chunks[index] ?? null;
}
