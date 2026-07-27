/** Port of Benzene.Azure.Function.EventGrid.EventGridOptions. */

/**
 * Configures how `EventGridApplication` / `EventGridBatchApplication` handle a message handler's
 * exceptions and failure results, and the batch fan-out concurrency. Mirrors the C# `EventGridOptions`
 * (and, in turn, `KafkaOptions`), keeping the C# defaults: `catchExceptions` off, `raiseOnFailureStatus`
 * on.
 */
export class EventGridOptions {
  /**
   * Whether an unhandled exception from a message handler is caught (logged, and the invocation reports
   * success — so Event Grid sees a delivered event and does not retry) instead of left to cascade and
   * fail the trigger invocation (Event Grid's own retry/dead-letter policy applies). Defaults to
   * `false` — an exception usually signals a transient failure worth retrying and eventually
   * dead-lettering.
   */
  catchExceptions = false;

  /**
   * Whether a message handler returning a non-exception failure result is escalated into a thrown
   * `EventGridMessageProcessingException`, so Event Grid retries the event the same way it would for an
   * unhandled exception (its retry runs with backoff up to 24h, then dead-letters). Defaults to `true`
   * (safe-by-default: a returned failure is escalated and redelivered; set `false` for at-most-once,
   * and keep the handler idempotent).
   */
  raiseOnFailureStatus = true;

  /**
   * The maximum number of events from a single batched delivery processed concurrently. `undefined`
   * (the default) leaves the fan-out unbounded. A value `<= 0` is treated the same as `undefined`.
   * Applies to batched delivery (trigger cardinality "many"); the default one-event-per-invocation
   * delivery has nothing to bound.
   */
  maxDegreeOfParallelism?: number;
}
