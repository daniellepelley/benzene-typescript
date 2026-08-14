/**
 * Computes the spec-pinned `contractHash` (contract-document.md §6):
 * `"sha256:" + lowercase-hex(sha256(canonicalJSON(normalize(document))))`, with `canonicalJSON` being
 * RFC 8785/JCS via the `canonicalize` npm package (the same one `contract-hash-cases.json` was
 * independently verified against - see its `description`). Port of
 * `Benzene.CodeGen.Core.ContractHash.Compute`.
 *
 * Operates on a plain JSON-shaped document: a `ContractDocument` value already *is* that shape, so
 * this accepts one directly (or an already-parsed raw object, e.g. a conformance fixture's `document`
 * field) with no serialize/re-parse round trip needed - unlike the C# original, which re-serializes its
 * typed `EventServiceDocument` through the OpenAPI writer specifically to get back to a JSON tree it
 * can strip fields from before canonicalizing.
 */
import canonicalize from 'canonicalize';
import { createHash } from 'node:crypto';
import { ContractDocument } from './ContractDocument';
import { isReservedEntry } from './ContractReservedTopics';

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

  const canonical = canonicalize(root);
  if (canonical === undefined) {
    // canonicalize() returns undefined only for a top-level `undefined` input, which JSON.parse can
    // never produce - kept as a defensive guard, not a reachable path.
    throw new Error('Failed to canonicalize the document for contractHash');
  }

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
