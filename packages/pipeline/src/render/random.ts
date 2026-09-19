/**
 * Deterministic randomness.
 *
 * A render is a pure function of (chunk, preset, seed). Re-running the
 * pipeline must produce the identical file, otherwise R-4 — every track
 * traceable to its recipe — is only a promise.
 */

export function seedFrom(...parts: Array<string | number>): number {
  let h = 2166136261 >>> 0;
  const input = parts.join('\u0000');
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  range(min: number, max: number): number;
}

/** mulberry32: small, fast, and good enough for choosing notes. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (maxExclusive: number) => Math.floor(next() * maxExclusive),
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('cannot pick from an empty list');
      return items[Math.floor(next() * items.length)]!;
    },
    range: (min: number, max: number) => min + next() * (max - min),
  };
}
