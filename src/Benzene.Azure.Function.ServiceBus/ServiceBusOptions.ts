/** Port of Benzene.Azure.Function.ServiceBus.ServiceBusOptions. */

/**
 * Configures how `ServiceBusApplication` / `ServiceBusBatchApplication` handle a message handler's
 * exceptions and failure results. Both flags default to `false` (purely additive/opt-in), preserving
 * the original behavior: a handler exception cascades and fails the whole trigger invocation, and a
 * non-exception failure result is silently accepted.
 */
export class ServiceBusOptions {
  /**
   * Whether an unhandled exception from a message handler is caught (logged, that message's failure
   * doesn't affect the rest of the batch) instead of left to cascade and fail the whole trigger
   * invocation. Defaults to `false`.
   */
  catchExceptions = false;

  /**
   * Whether a message handler returning a non-exception failure result is escalated into a thrown
   * `ServiceBusMessageProcessingException`, so a failure is treated the same as an unhandled exception
   * for retry purposes. Defaults to `false`.
   */
  raiseOnFailureStatus = false;
}
