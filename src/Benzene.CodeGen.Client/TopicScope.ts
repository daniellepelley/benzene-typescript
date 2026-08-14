/**
 * The single topic-scoping implementation shared by `buildMessageClientSdk` and `buildAtomicClientSdk`
 * (applied once, before any per-topic emission site runs), so those sites can't disagree with each
 * other about what's in scope. Port of `Benzene.CodeGen.Client.TopicScope`.
 */
import { ClientSdkOptions } from './ClientSdkOptions';
import { ContractDocument, ContractRequestResponse } from './ContractDocument';
import { isReservedEntry } from './ContractReservedTopics';

/**
 * Thrown by `applyTopicScope` when `options.topics` names a topic the document doesn't have
 * (contract-document.md §5.2's fail-loud rule). Carries both sets so a caller (or the CLI) can report
 * exactly what was wrong without re-deriving them.
 */
export class UnknownTopicsError extends Error {
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
 * Projects `document.requests` down to the topics in scope per `options`, returning a new document
 * with everything else (`info`, `events`, `components`, `messageEndpoint`, `transports`) unchanged.
 * `benzene:healthcheck` (or any other reserved topic) has no special case here: it is excluded by
 * default like any other reserved topic, and admitted only by `options.includeReserved` or by
 * being named in `options.topics` - generated clients are for a service's *domain* surface by default.
 */
export function applyTopicScope(
  document: ContractDocument,
  options: Pick<ClientSdkOptions, 'topics' | 'includeReserved'>,
): ContractDocument {
  const requestedTopics = options.topics !== undefined && options.topics.length > 0 ? options.topics : undefined;

  if (requestedTopics !== undefined) {
    const known = new Set(document.requests.map((request) => request.topic));
    const unknown = requestedTopics.filter((topic) => !known.has(topic));
    if (unknown.length > 0) {
      throw new UnknownTopicsError(unknown, [...known]);
    }
  }

  const included = requestedTopics !== undefined ? new Set(requestedTopics) : undefined;

  const inScope = (request: ContractRequestResponse): boolean =>
    included !== undefined
      ? included.has(request.topic)
      : options.includeReserved === true || !isReservedEntry(request);

  return {
    ...document,
    requests: document.requests.filter(inScope),
  };
}
