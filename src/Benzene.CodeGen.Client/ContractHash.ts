/**
 * Computes the spec-pinned `contractHash` (contract-document.md §6):
 * `"sha256:" + lowercase-hex(sha256(canonicalJSON(normalize(document))))`. `canonicalJSON` is
 * RFC 8785/JCS, implemented inline by {@link canonicalizeJcs} rather than via the `canonicalize` npm
 * package: that package ships ESM-only (no `require` export condition), which this repo's compiled
 * CommonJS `dist/` output (see scripts/build.mjs) cannot load. For the plain-JSON values a Contract
 * Document is built from - no `NaN`/`Infinity`, no exotic numbers - JCS reduces to exactly two rules
 * beyond default `JSON.stringify`: object keys sorted by UTF-16 code unit, applied recursively at
 * every level. `JSON.stringify`'s own number/string serialization already matches JCS's mandated
 * ECMAScript `Number::toString` behaviour (including `-0` -> `"0"`) because JCS mandates that exact
 * algorithm. Cross-checked byte-for-byte against the `canonicalize` package's output for every
 * `contract-hash-cases.json` case and every `contract-document-cases.json` document before this
 * inlining. Port of `Benzene.CodeGen.Core.ContractHash.Compute`.
 *
 * Operates on a plain JSON-shaped document: a `ContractDocument` value already *is* that shape, so
 * this accepts one directly (or an already-parsed raw object, e.g. a conformance fixture's `document`
 * field) with no serialize/re-parse round trip needed - unlike the C# original, which re-serializes its
 * typed `EventServiceDocument` through the OpenAPI writer specifically to get back to a JSON tree it
 * can strip fields from before canonicalizing.
 */
import { createHash } from 'node:crypto';
import { ContractDocument } from './ContractDocument';
import { isReservedEntry } from './ContractReservedTopics';

/** RFC 8785 (JCS) canonicalization of a plain JSON value - see the module doc comment above. */
function canonicalizeJcs(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  const valueType = typeof value;
  if (valueType === 'boolean' || valueType === 'string') {
    return JSON.stringify(value);
  }
  if (valueType === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new Error('JCS canonicalization does not support NaN/Infinity');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJcs).join(',')}]`;
  }
  if (valueType === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizeJcs(record[key])}`).join(',')}}`;
  }
  throw new Error(`Cannot canonicalize a value of type ${valueType}`);
}

export interface ComputeContractHashOptions {
  /**
   * Selects which of §6.2's two `normalize()` behaviours applies to a surviving reserved
   * `requests[]` entry: `false` (the default - a whole-service or a service-level, include-list
   * filtered document, §5.2) removes every reserved entry entirely; `true` (the topic-scoped,
   * single-topic shape of §5.3) does not - it only strips the entry's `reserved` flag, so a topic
   * explicitly named in an atomic client's include-list survives the hash even if it is reserved.
   */
  topicScoped?: boolean;
}

/** Computes the contract hash of `document` (or whatever projection of one it already is). */
export function computeContractHash(
  document: ContractDocument | Record<string, unknown>,
  options: ComputeContractHashOptions = {},
): string {
  // A JSON round-trip clone: normalize() mutates in place, and the caller's document must not be
  // touched (a generator may still need the pre-normalize document afterwards).
  const root = JSON.parse(JSON.stringify(document)) as Record<string, unknown>;

  normalize(root, options.topicScoped === true);

  const canonical = canonicalizeJcs(root);

  const digest = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return `sha256:${digest}`;
}

function normalize(root: Record<string, unknown>, isTopicScoped: boolean): void {
  delete root['messageEndpoint'];
  delete root['transports'];

  const requests = root['requests'];
  if (Array.isArray(requests)) {
    const reservedEntries = new Set<unknown>();

    for (const requestNode of requests) {
      if (typeof requestNode !== 'object' || requestNode === null) {
        continue;
      }
      const request = requestNode as Record<string, unknown>;

      delete request['example'];

      // §6.2 requires reserved-ness to be evaluated (flag OR the `benzene:` prefix, §5.1) BEFORE the
      // `reserved` flag itself is stripped - do that here, in that order.
      const reservedByFlag = request['reserved'] === true;
      const topic = typeof request['topic'] === 'string' ? request['topic'] : undefined;
      const isReserved = isReservedEntry({ topic: topic ?? '', reserved: reservedByFlag });

      delete request['reserved'];

      if (isReserved) {
        reservedEntries.add(requestNode);
      }
    }

    // Only a whole-service (not topic-scoped, §5.3) document has its reserved entries removed
    // entirely - a topic-scoped document that explicitly asked for a reserved topic keeps it (with
    // only the flag already stripped above).
    if (!isTopicScoped && reservedEntries.size > 0) {
      root['requests'] = requests.filter((requestNode) => !reservedEntries.has(requestNode));
    }
  }

  const events = root['events'];
  if (Array.isArray(events)) {
    for (const eventNode of events) {
      if (typeof eventNode === 'object' && eventNode !== null) {
        delete (eventNode as Record<string, unknown>)['example'];
      }
    }
  }
}
