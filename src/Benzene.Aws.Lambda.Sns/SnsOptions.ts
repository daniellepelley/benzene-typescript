/** Port of Benzene.Aws.Lambda.Sns.SnsOptions. */

/**
 * Configures how `SnsApplication` handles a message handler's exceptions and failure results.
 * Safe-by-default, matching the .NET 1.0 settlement contract: `catchExceptions` off (a handler
 * exception cascades so SNS's own subscription retry policy applies) and `raiseOnFailureStatus` on (a
 * returned failure result — or a null/unestablished outcome — is escalated so SNS redelivers it).
 */
export class SnsOptions {
  /**
   * Whether an unhandled exception from a message handler is caught (logged, and the Lambda invocation
   * reports success to SNS — no retry) instead of left to cascade out of the invocation. Defaults to
   * `false` — an exception usually signals a transient/unexpected failure worth retrying (and eventually
   * dead-lettering via the subscription's redrive policy); silently swallowing it risks losing the
   * message forever.
   */
  catchExceptions = false;

  /**
   * Whether a message handler returning a non-exception failure result (e.g. a validation error) is
   * escalated into a thrown `SnsMessageProcessingException`, so SNS retries the notification the same
   * way it would for an unhandled exception. Defaults to `true` — a returned failure is not silently
   * settled, so the message is redelivered (and eventually dead-lettered via the subscription's redrive
   * policy) rather than lost: at-least-once out of the box. Because a retried delivery re-runs the
   * handler with the same message (SNS provides no dedup), the handler must be idempotent. Set to
   * `false` for at-most-once, where a failure result is accepted and the notification is not retried.
   */
  raiseOnFailureStatus = true;
}
