/** Port of Benzene.GoogleCloud.Functions.PubSub.PubSubOptions. */

/**
 * Configures how `PubSubMiddlewareApplication` handles a message handler's exceptions and failure
 * results.
 */
export class PubSubOptions {
  /**
   * Whether an unhandled exception from a message handler is caught (logged) instead of left to cascade
   * and fail the whole invocation. Defaults to `false` — the Functions Framework has no partial-failure
   * mechanism (Pub/Sub delivers one message per invocation), so an uncaught exception (which the
   * framework turns into a non-2xx response) is the only way the subscription's own retry/dead-letter
   * policy notices anything went wrong.
   */
  catchExceptions = false;

  /**
   * Whether a message handler returning a non-exception failure result is escalated into a thrown
   * `PubSubMessageProcessingException`, so a failure is treated the same as an unhandled exception for
   * retry purposes. Defaults to `true` (safe-by-default: a returned failure is escalated and
   * redelivered; set `false` for at-most-once, and keep the handler idempotent). Faithful to the .NET
   * default — unlike the batch-oriented Azure Service Bus trigger, whose `raiseOnFailureStatus` defaults
   * `false`.
   */
  raiseOnFailureStatus = true;
}
