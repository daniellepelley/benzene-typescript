/** Port of Benzene.Azure.Function.ServiceBus.ServiceBusOptions. */

/**
 * Configures how `ServiceBusApplication` / `ServiceBusBatchApplication` handle a message handler's
 * exceptions and failure results. Safe-by-default, matching the .NET 1.0 settlement contract:
 * `catchExceptions` off (a handler exception cascades and fails the trigger invocation, so Service
 * Bus's delivery-count/dead-letter machinery applies) and `raiseOnFailureStatus` on (a returned
 * failure result — or a null/unestablished outcome — is escalated the same way).
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
   * for retry purposes. Defaults to `true` — a returned failure is escalated and redelivered
   * (at-least-once), eventually dead-lettering via the queue's max-delivery-count; the handler must be
   * idempotent. Set `false` for at-most-once, where a failure result is accepted as settled.
   */
  raiseOnFailureStatus = true;
}
