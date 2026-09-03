/** Port of Benzene.Aws.Lambda.S3.S3Options. */

/**
 * Configures how `S3Application` handles a message handler's exceptions and failure results. Mirrors
 * `@benzenejs/aws-lambda-sns`'s `SnsOptions`. Safe-by-default, matching the .NET 1.0 settlement
 * contract: `catchExceptions` off, `raiseOnFailureStatus` on.
 */
export class S3Options {
  /**
   * Whether an unhandled exception from a message handler is caught (logged, and the Lambda invocation
   * reports success — so S3's async-invoke retry/on-failure destination does not engage) instead of
   * left to cascade out of the invocation. Defaults to `false` — an exception usually signals a
   * transient/unexpected failure worth retrying and eventually dead-lettering via the function's own
   * retry/destination configuration.
   */
  catchExceptions = false;

  /**
   * Whether a message handler returning a non-exception failure result (e.g. a validation error) is
   * escalated into a thrown `S3MessageProcessingException`, so S3's async-invoke retry applies the
   * same way it would for an unhandled exception. Defaults to `true` — a returned failure is escalated
   * and redelivered (at-least-once). Set `false` for at-most-once (a failure result is accepted, not
   * retried); either way the handler must be idempotent.
   */
  raiseOnFailureStatus = true;
}
