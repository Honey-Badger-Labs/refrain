/**
 * Identifier rules.
 *
 * Every id that can appear in a URL is restricted to a small, non-ambiguous
 * alphabet. This is the first half of SEC-1: a route segment that does not
 * match `ID_PATTERN` is rejected before it is ever compared against the
 * catalogue, so no catalogue lookup is performed on attacker-shaped input.
 */

/** Lowercase letters, digits and single hyphens. No leading or trailing hyphen. */
export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Track ids are composed of two ids joined by `--`, so they carry one double
 * hyphen that route segments never may. They are internal: no track id appears
 * in a URL, which is why they get their own, slightly wider alphabet.
 */
export const TRACK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*--[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const MAX_ID_LENGTH = 64;
export const MAX_TRACK_ID_LENGTH = MAX_ID_LENGTH * 2 + 2;

export function isId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    ID_PATTERN.test(value)
  );
}

/** Turn a human title into a usable id. Deterministic, lossy on purpose. */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ID_LENGTH)
    .replace(/-+$/g, '');
  if (!slug) throw new Error(`Cannot slugify ${JSON.stringify(input)}: nothing left`);
  return slug;
}

/**
 * A track's id is derived, not assigned, so the same chunk rendered with the
 * same preset always lands on the same id. R-4: every track traces back.
 */
export function trackId(chunkId: string, presetId: string): string {
  return `${chunkId}--${presetId}`;
}

export function isTrackId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_TRACK_ID_LENGTH &&
    TRACK_ID_PATTERN.test(value)
  );
}
