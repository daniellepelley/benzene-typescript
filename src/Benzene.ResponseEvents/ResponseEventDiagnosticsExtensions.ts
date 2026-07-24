import {
  ILogger,
  ILoggerFactory,
  IServiceResolver,
  serviceIdentifierName,
  VoidResult,
} from '@benzene/abstractions';
import { IMessageHandlersFinder } from '@benzene/abstractions-message-handlers';
import { IResponseEventCatalog } from './ResponseEventCatalog';
import { ResponseEventGap } from './ResponseEventGap';

const loggerCategory = 'Benzene.ResponseEvents.Diagnostics';

/**
 * Opt-in startup diagnostic for the "response payload with nowhere to go" gap: a request/response
 * handler whose response is silently discarded when it runs on a fire-and-forget transport and no
 * `useResponseEvents` mapping republishes it. Advisory - never throws.
 * Port of Benzene.ResponseEvents.ResponseEventDiagnosticsExtensions.
 */

/**
 * Finds every registered handler that returns a response payload on a topic no response-event mapping
 * covers. Returns an empty array when handler discovery isn't available.
 */
export function findUnmappedResponseHandlers(serviceResolver: IServiceResolver): ResponseEventGap[] {
  const handlersFinder = serviceResolver.tryGetService(IMessageHandlersFinder);
  if (handlersFinder === undefined) {
    return [];
  }

  const catalog = serviceResolver.tryGetService(IResponseEventCatalog);

  return handlersFinder
    .findDefinitions()
    .filter(
      (definition) =>
        definition.responseType !== VoidResult &&
        definition.handlerType !== (VoidResult as unknown) &&
        !(catalog?.coversTopic(definition.topic) ?? false),
    )
    .sort(
      (a, b) =>
        compareOrdinal(a.topic.id, b.topic.id) ||
        compareOrdinal(serviceIdentifierName(a.handlerType), serviceIdentifierName(b.handlerType)),
    )
    .map((definition) => new ResponseEventGap(definition.topic, definition.handlerType, definition.responseType));
}

/**
 * Runs {@link findUnmappedResponseHandlers} and logs each gap as a warning, returning the findings so
 * the caller can act further. A no-op with no findings.
 * @param logger Logger to warn on; resolved from DI when omitted.
 */
export function logUnmappedResponseHandlers(
  serviceResolver: IServiceResolver,
  logger?: ILogger,
): ResponseEventGap[] {
  const gaps = findUnmappedResponseHandlers(serviceResolver);
  if (gaps.length === 0) {
    return gaps;
  }

  const resolved =
    logger ?? serviceResolver.tryGetService(ILoggerFactory)?.createLogger(loggerCategory);
  if (resolved !== undefined) {
    for (const gap of gaps) {
      resolved.logWarning(gap.description);
    }
  }

  return gaps;
}

/** Ordinal (code-unit) string comparison, matching C#'s `StringComparer.Ordinal`. */
function compareOrdinal(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}
