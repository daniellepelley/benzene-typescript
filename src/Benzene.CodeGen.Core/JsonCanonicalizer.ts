/**
 * RFC 8785 (the JSON Canonicalization Scheme, JCS) for plain JSON values. Port of
 * `Benzene.CodeGen.Core.JsonCanonicalizer`.
 *
 * Implemented inline rather than via the `canonicalize` npm package: that package ships ESM-only (no
 * `require` export condition), which this repo's compiled CommonJS `dist/` output cannot load, and the
 * port takes no third-party runtime dependency for it. For plain JSON values (no `NaN`/`Infinity`), JCS
 * is exactly `JSON.stringify` with object members sorted by UTF-16 code unit at every level:
 * `JSON.stringify`'s string escaping and number formatting already ARE the ECMAScript algorithms RFC 8785
 * mandates (including `-0` -> `"0"`), and JavaScript's default string ordering is by UTF-16 code unit.
 * `conformance/contract-hash-cases.json` is the proof (contract-document.md §6.3).
 */
export const JsonCanonicalizer = {
  /** The canonical (RFC 8785) serialization of `value`. Throws on a value JSON cannot represent. */
  canonicalize(value: unknown): string {
    return canonicalize(value);
  },
} as const;

function canonicalize(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error('JCS canonicalization does not support NaN or Infinity');
      }
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(',')}]`;
      }
      const record = value as Record<string, unknown>;
      const members = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
      return `{${members.join(',')}}`;
    }
    default:
      throw new Error(`Cannot canonicalize a value of type ${typeof value}`);
  }
}
