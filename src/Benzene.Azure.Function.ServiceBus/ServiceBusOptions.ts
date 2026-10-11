/** Port of Benzene.Azure.Function.ServiceBus.ServiceBusOptions. */
import { SettlementOptions } from '@benzenejs/core-message-handlers';

/**
 * Configures how `ServiceBusApplication` / `ServiceBusBatchApplication` settle each message
 * (transport-bindings §1, obligation 8) — a **queue** binding. Defaults are **at-least-once**, as in .NET:
 * a failure result, a missing result and an uncaught exception all fail the trigger invocation, so the
 * Functions host abandons the message and Service Bus redelivers it (up to the entity's max delivery
 * count, then its dead-letter queue). The unit of settlement is the invocation (one message, or the
 * delivered batch).
 */
export class ServiceBusOptions implements SettlementOptions {
  /**
   * Whether an unhandled exception from a message handler is caught (logged, that message's failure
   * doesn't affect the rest of the batch) instead of left to cascade and fail the whole trigger
   * invocation. Defaults to `false`.
   */
  catchExceptions = false;

  /**
   * Whether a failure result — or no result at all — is escalated into a thrown
   * `ServiceBusMessageProcessingException`, so it is retried the same as an unhandled exception. Defaults
   * to `true` (.NET's default; was `false` before spec-0.2.0).
   */
  raiseOnFailureStatus = true;

  /** See {@link SettlementOptions.atMostOnce}: acknowledge every message, whatever the outcome. */
  atMostOnce = false;

  /** See {@link SettlementOptions.ignoreUnmatchedTopics}: acknowledge a message whose topic no handler serves. */
  ignoreUnmatchedTopics = false;
}
