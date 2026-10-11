/** Port of Benzene.Azure.Function.EventHub.Function.EventHubOptions. */
import { SettlementOptions } from '@benzenejs/core-message-handlers';

/**
 * Configures how `EventHubApplication` settles a triggered Event Hub batch (transport-bindings §1,
 * obligation 8) — a **stream** binding. The unit of settlement is the **invocation** (the trigger batch,
 * which the host checkpoints when the invocation succeeds): a failure fails it, and whether the host then
 * redelivers the batch depends on the trigger's retry policy, which the application configures.
 *
 * Defaults, and the stream carve-out they document (matching .NET, whose base class overrides
 * `EscalateUnestablishedOutcome` to `false` for this trigger):
 * - a **failure result** (inside the envelope too) or an **uncaught exception** fails the invocation;
 * - a **missing result** — including an event whose body is not an envelope — is acknowledged
 *   (skip-and-continue): Event Hubs has no per-event dead-letter path;
 * - an **unmatched topic** is acknowledged too (`ignoreUnmatchedTopics` defaults `true` here).
 */
export class EventHubOptions implements SettlementOptions {
  /**
   * Whether an unhandled exception is caught (logged; the event is skipped so its siblings complete and
   * the batch checkpoints) instead of failing the whole invocation. Defaults to `false`.
   */
  catchExceptions = false;

  /**
   * Whether a failure result is escalated into a thrown `EventHubMessageProcessingException`, failing the
   * invocation so the batch is redelivered rather than checkpointed past. Defaults to `true` (.NET's
   * default).
   */
  raiseOnFailureStatus = true;

  /** The maximum number of events processed concurrently; `undefined` (the default) is unbounded. */
  maxDegreeOfParallelism?: number;

  /** See {@link SettlementOptions.atMostOnce}: acknowledge the batch, whatever the outcome. */
  atMostOnce = false;

  /** See {@link SettlementOptions.ignoreUnmatchedTopics}. Defaults to `true` on this stream binding. */
  ignoreUnmatchedTopics = true;
}
