/**
 * Entity-tag comparison for conditional requests (RFC 9110 §8.8.3, §13.1). An entity tag is a quoted
 * string, optionally prefixed `W/` (weak): `"v1"`, `W/"v1"`.
 * Port of Benzene.Http.Conditional.EntityTags (C# `static class` -> frozen object literal, as
 * `ProblemTypes` does; C# `string?` -> `string | undefined | null`).
 */
export const EntityTags = {
  /** Makes a strong entity tag from an opaque value: `strong('v1')` gives `"v1"`. */
  strong(value: string): string {
    return `"${value}"`;
  },

  /** Makes a weak entity tag from an opaque value: `weak('v1')` gives `W/"v1"`. */
  weak(value: string): string {
    return `W/"${value}"`;
  },

  /**
   * Whether an `If-Match` header matches `currentETag`: `*` matches any, and a list matches when one
   * member does. Strong comparison (RFC 9110 §13.1.1): a weak tag never matches.
   */
  ifMatch(ifMatch: string | undefined | null, currentETag: string): boolean {
    return matches(ifMatch, currentETag, false);
  },

  /**
   * Whether an `If-None-Match` header matches `currentETag`, meaning the caller's copy is current: `*`
   * matches any, a list when one member does. Weak comparison (RFC 9110 §13.1.2): `W/"v1"` matches
   * `"v1"`.
   */
  ifNoneMatch(ifNoneMatch: string | undefined | null, currentETag: string): boolean {
    return matches(ifNoneMatch, currentETag, true);
  },
} as const;

function matches(header: string | undefined | null, currentETag: string, weak: boolean): boolean {
  if (header === undefined || header === null || header.trim() === '' || currentETag.trim() === '') {
    return false;
  }

  if (header.trim() === '*') {
    return true;
  }

  const current = currentETag.trim();
  const candidates = header
    .split(',')
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate !== '');
  for (const candidate of candidates) {
    if (weak) {
      if (opaque(candidate) === opaque(current)) {
        return true;
      }
    } else if (!isWeak(candidate) && !isWeak(current) && candidate === current) {
      return true;
    }
  }

  return false;
}

function isWeak(tag: string): boolean {
  return tag.startsWith('W/');
}

function opaque(tag: string): string {
  return isWeak(tag) ? tag.substring(2) : tag;
}
