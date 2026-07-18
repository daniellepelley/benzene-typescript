/** Port of Benzene.Aws.Lambda.Sns.SnsOptions. */

/**
 * Configures how `SnsApplication` handles a message handler's exceptions and failure results. Both flags
 * default to `false` (purely additive/opt-in), preserving the original behavior: a handler exception
 * cascades out of the invocation (SNS's own subscription retry policy applies) and a non-exception failure
 * result is silently accepted (no retry).
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
   * escalated into a thrown `SnsMessageProcessingException`, so SNS retries the notification the same way
   * it would for an unhandled exception. Defaults to `false` — a failure result usually reflects a
   * permanent/business-logic failure that retrying won't fix.
   */
  raiseOnFailureStatus = false;
}
