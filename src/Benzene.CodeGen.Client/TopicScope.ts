/**
 * The single topic-scoping implementation shared by `buildMessageClientSdk` and `buildAtomicClientSdk`
 * (applied once, before any per-topic emission site runs), so those sites can't disagree with each
 * other about what's in scope. Port of `Benzene.CodeGen.Client.TopicScope`.
 */
import { ClientSdkOptions } from './ClientSdkOptions';
import { withRecomputedHashes } from './ContractHash';
import { ContractDocument } from './ContractDocument';

/**
 * Thrown by `applyTopicScope` when `options.topics` names a topic the document doesn't have
 * (contract-document.md §5.2's fail-loud rule). Carries both sets so a caller (or the CLI) can report
 * exactly what was wrong without re-deriving them.
 */
export class UnknownTopicsError extends Error {
  /** The conformance error kind (`conformance/README.md`). */
  readonly kind = 'unknown-topics';

  constructor(
    readonly unknownTopics: readonly string[],
    readonly validTopics: readonly string[],
  ) {
    super(
      `--topics names topic(s) not present in the document: ${unknownTopics.join(', ')}. ` +
        `Valid topics: ${[...validTopics].sort().join(', ')}.`,
    );
    this.name = 'UnknownTopicsError';
  }
}

/**
 * The include-list projection (contract-document.md §5.2): `document.requests` narrowed to the topics in
 * `options.topics` (every one when absent or empty), with `events`, `sends`, `components` and the
 * document-level fields unchanged except `contractHash`/`registrationHash`, which are recomputed over the
 * projection. A parsed document never holds `benzene:` entries (the parser ignores them), so there is no
 * reserved-topic option.
 */
export function applyTopicScope(document: ContractDocument, options: Pick<ClientSdkOptions, 'topics'>): ContractDocument {
  const requestedTopics = options.topics !== undefined && options.topics.length > 0 ? options.topics : undefined;
  if (requestedTopics === undefined) {
    return withRecomputedHashes(document);
  }

  const known = new Set(document.requests.map((request) => request.topic));
  const unknown = requestedTopics.filter((topic) => !known.has(topic));
  if (unknown.length > 0) {
    throw new UnknownTopicsError(unknown, [...known]);
  }

  const included = new Set(requestedTopics);
  return withRecomputedHashes({
    ...document,
    requests: document.requests.filter((request) => included.has(request.topic)),
  });
}
