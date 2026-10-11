/**
 * The topic-scoped projection of contract-document.md §5.3: a self-contained, single-topic document -
 * `requests` holds exactly that one entry, `events` and `sends` are empty, `components.schemas` is
 * narrowed to exactly what that topic's request/response reach, and `contractHash`/`registrationHash` are
 * recomputed over the projection. Every other field passes through unchanged. This is what `buildAtomicClientSdk` generates each topic-client from, and what its
 * embedded contract hash is computed over.
 */
import { withRecomputedHashes } from './ContractHash';
import { ContractDocument } from './ContractDocument';
import { reachableSchemas } from './SchemaClosure';

/** Projects `document` to `topic`'s topic-scoped shape. Throws if `topic` isn't in `document.requests`. */
export function projectTopicScoped(document: ContractDocument, topic: string): ContractDocument {
  const request = document.requests.find((entry) => entry.topic === topic);
  if (request === undefined) {
    const known = document.requests.map((entry) => entry.topic).sort();
    throw new Error(`Topic '${topic}' is not present in the document. Valid topics: ${known.join(', ')}.`);
  }

  return withRecomputedHashes({
    ...document,
    requests: [request],
    events: [],
    sends: [],
    components: { schemas: reachableSchemas(document.components.schemas, request.request, request.response) },
  });
}
