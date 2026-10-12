import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { BenzeneResult } from './BenzeneResult';
import { convertHttpStatusCode } from './BenzeneResultExtensions';
import { BenzeneResultStatus } from './BenzeneResultStatus';

/**
 * transport-bindings.md §1 (spec 1.1): a send that fails in transport - no connection, a refused or reset
 * request, the client's own deadline - before any reply arrives (or, for a one-way client, before the broker
 * accepts the message) SHOULD yield a result rather than an exception: `timeout` when the deadline elapsed,
 * otherwise `service-unavailable`, so a caller handles a dead peer as it handles every other failure. These
 * functions are that rule, shared by every client in the port - reply-receiving and one-way alike.
 *
 * What counts as "the deadline elapsed", for the errors a Node client actually sees:
 * - an aborted call (`AbortError`, or the `TimeoutError` an `AbortSignal.timeout(ms)` aborts with): in
 *   JavaScript an `AbortSignal` is how a caller bounds a `fetch` (it has no timeout option of its own), so an
 *   abort is the caller's own deadline;
 * - an error whose name ends in `TimeoutError` (the AWS SDK's request/connection timeouts, kafkajs's
 *   `KafkaJSRequestTimeoutError`);
 * - a timeout code: undici/Node's (`UND_ERR_CONNECT_TIMEOUT`, `UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT`,
 *   `ETIMEDOUT`, `ESOCKETTIMEDOUT`) or the Azure messaging SDKs' (`ServiceTimeout`, `OperationTimeoutError`);
 * - a gRPC-shaped error (numeric `code` beside a string `details`, as the Pub/Sub client throws) whose code is
 *   4, `DEADLINE_EXCEEDED`;
 *
 * each looked for on the error and its `cause` chain - `fetch` rejects with `TypeError('fetch failed')` and
 * puts the socket error in `cause`.
 *
 * Everything else - `ECONNREFUSED`, `ECONNRESET`, a DNS failure, a TLS failure - is `service-unavailable`.
 */
export function transportFailureStatus(error: unknown): string {
  for (const link of causeChain(error)) {
    if (typeof link !== 'object' || link === null) {
      continue;
    }
    const { name, code, details } = link as { name?: unknown; code?: unknown; details?: unknown };
    if (name === 'AbortError' || (typeof name === 'string' && name.endsWith('TimeoutError'))) {
      return BenzeneResultStatus.timeout;
    }
    if (typeof code === 'string' && TimeoutCodes.has(code)) {
      return BenzeneResultStatus.timeout;
    }
    if (code === GrpcDeadlineExceeded && typeof details === 'string') {
      return BenzeneResultStatus.timeout;
    }
  }
  return BenzeneResultStatus.serviceUnavailable;
}

/**
 * The failed result for a call that failed before any reply arrived: {@link transportFailureStatus}'s status,
 * with one error carrying the failure's message (and its `cause`'s, which is where `fetch` puts the socket
 * error), so the reason is not lost with the exception.
 */
export function transportFailureResult<T>(error: unknown): IBenzeneResultOf<T> {
  return BenzeneResult.setErrors<T>(transportFailureStatus(error), transportFailureMessage(error));
}

/**
 * The result for a one-way send whose SDK call rejected. When the broker itself answered - an AWS SDK service
 * exception (`$metadata.httpStatusCode`) or an Azure `RestError` (`statusCode`), 400 or above - the message
 * was refused, not lost in transport, so that native status maps through the reverse HTTP table
 * (wire-contracts §4.1: `403` → `forbidden`, `404` → `not-found`, `429` → `too-many-requests`, ...).
 * Otherwise the send failed before the broker accepted it: {@link transportFailureResult}. Either way the
 * one error carries the failure's message.
 */
export function failedSendResult<T>(error: unknown): IBenzeneResultOf<T> {
  const brokerStatus = brokerHttpStatus(error);
  return brokerStatus === undefined
    ? transportFailureResult<T>(error)
    : BenzeneResult.setErrors<T>(convertHttpStatusCode(brokerStatus).status, transportFailureMessage(error));
}

/** The HTTP status a broker answered a rejected SDK call with, when it answered at all. */
function brokerHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const { $metadata, statusCode } = error as { $metadata?: { httpStatusCode?: unknown }; statusCode?: unknown };
  const status = $metadata?.httpStatusCode ?? statusCode;
  return typeof status === 'number' && status >= 400 ? status : undefined;
}

const TimeoutCodes = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'ServiceTimeout',
  'OperationTimeoutError',
]);

/** gRPC's `DEADLINE_EXCEEDED`. */
const GrpcDeadlineExceeded = 4;

function transportFailureMessage(error: unknown): string {
  const messages: string[] = [];
  for (const link of causeChain(error)) {
    const message = link instanceof Error ? link.message : typeof link === 'string' ? link : undefined;
    if (message !== undefined && message !== '' && !messages.includes(message)) {
      messages.push(message);
    }
  }
  return messages.length > 0 ? messages.join(': ') : 'The call failed before any reply arrived';
}

/** `error`, then each `cause` beneath it (bounded, so a cyclic chain cannot loop). */
function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  while (current !== undefined && current !== null && chain.length < 8 && !chain.includes(current)) {
    chain.push(current);
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined;
  }
  return chain;
}
