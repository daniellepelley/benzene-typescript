/** Port of Benzene.Aws.Lambda.EventBridge.EventBridgeOptions. */

/**
 * Configures how `EventBridgeApplication` handles a message handler's exceptions and failure results.
 * Mirrors `@benzenejs/aws-lambda-sns`'s `SnsOptions`. Safe-by-default, matching the .NET 1.0
 * settlement contract: `catchExceptions` off, `raiseOnFailureStatus` on.
 */
export class EventBridgeOptions {
  /**
   * Whether an unhandled exception from a message handler is caught (logged, and the Lambda invocation
   * reports success — so the EventBridge rule target sees a delivered event and does not retry)
   * instead of left to cascade out of the invocation (the target's own retry/on-failure-destination
   * policy applies). Defaults to `false` — an exception usually signals a transient/unexpected failure
   * worth retrying and eventually dead-lettering.
   */
  catchExceptions = false;

  /**
   * Whether a message handler returning a non-exception failure result (e.g. a validation error) is
   * escalated into a thrown `EventBridgeMessageProcessingException`, so the EventBridge rule target
   * retries the event the same way it would for an unhandled exception. Defaults to `true`
   * (safe-by-default): a returned failure is escalated and redelivered (at-least-once), so the handler
   * must be idempotent. Set `false` for at-most-once, where a failure result is accepted and the event
   * is not retried.
   */
  raiseOnFailureStatus = true;
}
