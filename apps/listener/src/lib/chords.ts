/**
 * Ukulele chord shapes for the play-along diagrams.
 *
 * Copied from MelodyFlow's chart table (instruments.js) rather than imported:
 * the listener fetches only its own origin and carries no cross-repo runtime
 * dependency. Strings are G C E A (re-entrant), and each number is the fret
 * held on that string, 0 for open.
 */
export const UKE_STRINGS = ['G', 'C', 'E', 'A'] as const;

export const UKE_SHAPES: Readonly<Record<string, readonly [number, number, number, number]>> = {
  C: [0, 0, 0, 3],
  C7: [0, 0, 0, 1],
  Cm: [0, 3, 3, 3],
  D: [2, 2, 2, 0],
  D7: [2, 2, 2, 3],
  Dm: [2, 2, 1, 0],
  E: [4, 4, 4, 2],
  E7: [1, 2, 0, 2],
  Em: [0, 4, 3, 2],
  F: [2, 0, 1, 0],
  G: [0, 2, 3, 2],
  G7: [0, 2, 1, 2],
  Gm: [0, 2, 3, 1],
  A: [2, 1, 0, 0],
  A7: [0, 1, 0, 0],
  Am: [2, 0, 0, 0],
  Bb: [3, 2, 1, 1],
  B7: [2, 3, 2, 2],
  Bm: [4, 2, 2, 2],
};

/** The chords over one line, as names. */
export function chordsOf(line: string | undefined): string[] {
  return (line ?? '').trim().split(/\s+/).filter(Boolean);
}

/** Every distinct chord a chunk uses, in the order it first appears. */
export function chordsUsed(chords: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  for (const line of chords ?? []) for (const c of chordsOf(line)) seen.add(c);
  return [...seen];
}

/** Spoken form of a shape, for a screen reader: "G open, C 2, E 3, A 2". */
export function describeShape(name: string): string | null {
  const shape = UKE_SHAPES[name];
  if (!shape) return null;
  return `${name} chord on ukulele: ` + shape.map((f, i) => `${UKE_STRINGS[i]} ${f === 0 ? 'open' : 'fret ' + f}`).join(', ');
}

/**
 * Where an A–B loop should send the playhead, or null to carry on. A loop
 * whose end is not after its start is no loop at all.
 */
export function loopTarget(time: number, a: number | null, b: number | null): number | null {
  if (a === null || b === null || b <= a) return null;
  return time >= b || time < a - 0.5 ? a : null;
}
