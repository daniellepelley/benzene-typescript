/** Port of Benzene.Aws.Lambda.EventBridge.EventBridgeOptions. */
import { SettlementOptions } from '@benzenejs/core-message-handlers';

/**
 * Configures how `EventBridgeApplication` settles the event (transport-bindings §1, obligation 8).
 * EventBridge invokes a Lambda target asynchronously with one event — a **one-shot** binding: failing the
 * invocation is the only way to get the event retried (the rule target's retry policy, then its DLQ /
 * on-failure destination). Mirrors `SnsOptions`.
 *
 * Defaults are **at-least-once**: a failure result, a missing result and an uncaught exception all fail
 * the invocation, so the event is redelivered; handlers must be idempotent. The unit of settlement is the
 * invocation, which carries exactly one event.
 */
export class EventBridgeOptions implements SettlementOptions {
  /**
   * Whether an unhandled exception from a message handler is caught (logged, and the invocation reports
   * success — the rule target sees a delivered event and does not retry) instead of left to cascade.
   * Defaults to `false`.
   */
  catchExceptions = false;

  /**
   * Whether a failure result — or no result at all — is escalated into a thrown
   * `EventBridgeMessageProcessingException`, so the rule target retries the event as it would for an
   * unhandled exception. Defaults to `true` (.NET's default).
   */
  raiseOnFailureStatus = true;

  /** See {@link SettlementOptions.atMostOnce}: acknowledge the event, whatever the outcome. */
  atMostOnce = false;

  /**
   * See {@link SettlementOptions.ignoreUnmatchedTopics}: acknowledge an event whose `detail-type` no
   * handler serves — the usual case for a rule matching more event types than this function handles.
   */
  ignoreUnmatchedTopics = false;
}
