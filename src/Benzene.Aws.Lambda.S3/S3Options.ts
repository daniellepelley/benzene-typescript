/** Port of Benzene.Aws.Lambda.S3.S3Options. */
import { SettlementOptions } from '@benzenejs/core-message-handlers';

/**
 * Configures how `S3Application` settles each object notification (transport-bindings §1, obligation 8).
 * S3 invokes the Lambda asynchronously — a **one-shot** binding: failing the invocation is the only way to
 * get the event retried (Lambda's async-invoke retry, then its on-failure destination). Mirrors
 * `SnsOptions`.
 *
 * Defaults are **at-least-once**: a failure result, a missing result and an uncaught exception all fail
 * the invocation; handlers must be idempotent. A throw fails every record in the event (the unit of
 * settlement is the invocation).
 */
export class S3Options implements SettlementOptions {
  /** Whether an unhandled exception is caught (logged; the record is acknowledged). Defaults to `false`. */
  catchExceptions = false;

  /**
   * Whether a failure result — or no result — is escalated into a thrown `S3MessageProcessingException`
   * so the event is retried. Defaults to `true` (.NET's default).
   */
  raiseOnFailureStatus = true;

  /** See {@link SettlementOptions.atMostOnce}: acknowledge every record, whatever the outcome. */
  atMostOnce = false;

  /** See {@link SettlementOptions.ignoreUnmatchedTopics}: acknowledge an event name no handler serves. */
  ignoreUnmatchedTopics = false;
}
