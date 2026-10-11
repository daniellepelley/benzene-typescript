/** Port of Benzene.Aws.Lambda.Sns.SnsOptions. */
import { SettlementOptions } from '@benzenejs/core-message-handlers';

/**
 * Configures how `SnsApplication` settles each notification (transport-bindings §1, obligation 8). SNS
 * invokes the Lambda asynchronously — a **one-shot** binding: failing the invocation is the only way to
 * get the notification retried (SNS's subscription retry policy, then its redrive policy / DLQ).
 *
 * Defaults are **at-least-once**: a failure result, a missing result and an uncaught exception all fail
 * the invocation, so the notification is redelivered; handlers must be idempotent. A throw fails every
 * record in the event (the unit of settlement is the invocation).
 */
export class SnsOptions implements SettlementOptions {
  /**
   * Whether an unhandled exception from a message handler is caught (logged, and the Lambda invocation
   * reports success to SNS — no retry) instead of left to cascade out of the invocation. Defaults to
   * `false` — an exception usually signals a transient/unexpected failure worth retrying (and eventually
   * dead-lettering via the subscription's redrive policy); silently swallowing it risks losing the
   * message forever.
   */
  catchExceptions = false;

  /**
   * Whether a message handler returning a failure result (e.g. a validation error) — or no result at all —
   * is escalated into a thrown `SnsMessageProcessingException`, so SNS retries the notification the same
   * way it would for an unhandled exception. Defaults to `true` (spec-0.2.0 settlement; .NET's default):
   * a failure is redelivered, not silently acknowledged. Set `false` to accept failure results.
   */
  raiseOnFailureStatus = true;

  /** See {@link SettlementOptions.atMostOnce}: acknowledge every notification, whatever the outcome. */
  atMostOnce = false;

  /** See {@link SettlementOptions.ignoreUnmatchedTopics}: acknowledge a notification no handler serves. */
  ignoreUnmatchedTopics = false;
}
