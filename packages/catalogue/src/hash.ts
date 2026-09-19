/**
 * Content hashing.
 *
 * `crypto.subtle` exists in browsers and in Node 20+, so one implementation
 * serves the pipeline that writes the catalogue and the app that verifies it.
 */

/**
 * Deterministic JSON: object keys sorted, no insignificant whitespace,
 * `undefined` dropped. Two structurally equal values always produce the same
 * string, so the hash does not change when a writer reorders its keys.
 */
export function canonicalise(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const v = source[key];
      if (v !== undefined) out[key] = sortValue(v);
    }
    return out;
  }
  return value;
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hash of a value's canonical form. Used for the catalogue and prompt hashes. */
export function hashValue(value: unknown): Promise<string> {
  return sha256Hex(canonicalise(value));
}
