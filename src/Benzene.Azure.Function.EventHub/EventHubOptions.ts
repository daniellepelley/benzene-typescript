/** Port of Benzene.Azure.Function.EventHub.Function.EventHubOptions. */

/**
 * Configures how `EventHubApplication` / `EventHubBatchApplication` handle a message handler's
 * exceptions and failure results while fanning a triggered batch of events out across the middleware
 * pipeline. Mirrors `@benzenejs/azure-function-queue-storage`'s `QueueStorageOptions` and
 * `@benzenejs/azure-function-event-grid`'s `EventGridOptions` on the failure-result axis; the
 * null-outcome axis is deliberately different — see the carve-out comment in
 * `EventHubBatchApplication`.
 *
 * ORDERING TRADEOFF: Event Hub records within a partition are ordered, and the default
 * (safe-by-default: `raiseOnFailureStatus` on, `catchExceptions` off) fan-out runs them concurrently
 * but lets any exception fail the whole invocation so the trigger re-delivers — and re-runs — the
 * entire batch, siblings included. Turning `catchExceptions` on trades that all-or-nothing re-delivery
 * for sibling isolation: a poison event is logged and skipped so its siblings are not re-run, but the
 * poison event is NOT retried and the batch still checkpoints past it.
 */
export class EventHubOptions {
  /**
   * Whether an unhandled exception from a message handler is caught (logged, and the event skipped —
   * so its siblings still complete and the batch checkpoints) instead of left to cascade and fail the
   * whole Functions invocation. When an exception cascades, the Event Hubs trigger re-delivers the
   * ENTIRE batch, so every already-succeeded sibling re-runs. Defaults to `false` — preserving the
   * all-or-nothing behavior. Turn it on to isolate a poison event from its siblings (see the ordering
   * tradeoff on `EventHubOptions`).
   */
  catchExceptions = false;

  /**
   * Whether a message handler returning a non-exception failure result is escalated into a thrown
   * `EventHubMessageProcessingException`, so the invocation fails and the Event Hubs trigger
   * re-delivers the batch the same way it would for an unhandled exception. Defaults to `true` — a
   * returned failure is escalated and redelivered (at-least-once). Set `false` for at-most-once (a
   * failure result is accepted, not retried); either way the handler must be idempotent.
   *
   * This reads `EventHubContext.messageResult`. In the default envelope routing path
   * (`useBenzeneMessage`) the handler runs on the inner `BenzeneMessageContext` with its response
   * suppressed; `BenzeneMessageEventHubHandler` surfaces that inner handler's result onto the outer
   * `EventHubContext.messageResult`, so this flag escalates a failure on the envelope path too.
   */
  raiseOnFailureStatus = true;
}
