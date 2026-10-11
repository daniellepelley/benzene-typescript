/**
 * Settlement — what a one-way binding (queue, topic, stream, event trigger) does with a message once the
 * pipeline has run (transport-bindings §1, obligation 8; D16).
 *
 * TypeScript-only module (no .NET file of this name): .NET carries this decision inside per-platform base
 * classes (`SingleContextEscalatingApplicationBase`, `AzureFunctionBatchApplicationBase`), which this port
 * does not have; every binding here calls these free functions instead, so the rule is written once.
 *
 * The rule, by default:
 * - a result with `isSuccessful: true` (`ignored` included) is acknowledged;
 * - a result with `isSuccessful: false`, **no result at all**, or an uncaught error is **not**
 *   acknowledged — the transport redelivers it, subject to its own redrive/dead-letter configuration;
 * - a topic no handler serves is a `not-found` failure, so it is redelivered too — unless the binding's
 *   {@link SettlementOptions.ignoreUnmatchedTopics} treats it as `ignored`.
 *
 * Every one-way binding's options type carries the same two knobs ({@link SettlementOptions}), so the
 * at-most-once override and the shared-bus option are spelled the same everywhere.
 */
import { IBenzeneResult } from '@benzenejs/abstractions';
import { IMessageResult } from '@benzenejs/abstractions-message-handlers';

/** The two settlement knobs every one-way binding's options type carries, spelled the same everywhere. */
export interface SettlementOptions {
  /**
   * The **at-most-once override**: acknowledge every message whatever the outcome — a failure result, no
   * result, or an uncaught error (logged, not rethrown). Nothing is ever redelivered, so a failed message
   * is lost. Defaults to `false` (at-least-once: handlers must be idempotent).
   */
  atMostOnce: boolean;

  /**
   * Treat a message whose topic matches no handler as `ignored` — acknowledged — instead of a `not-found`
   * failure that is redelivered. For a subscriber on a shared bus that sees other services' topics.
   * Defaults to `false` on queue and one-shot bindings; a stream binding may default it on (see its
   * options type).
   */
  ignoreUnmatchedTopics: boolean;
}

/** What a binding does with an absent result: redeliver it (the default) or acknowledge it. */
export type MissingResultSettlement = 'redeliver' | 'acknowledge';

/** Inputs to {@link isSettledAsFailure} beyond the result itself. */
export interface SettlementDecisionOptions {
  /** See {@link SettlementOptions.ignoreUnmatchedTopics}. Defaults to `false`. */
  readonly ignoreUnmatchedTopics?: boolean;

  /**
   * What an absent result means. Defaults to `'redeliver'` (the spec's rule). A stream binding that
   * carves the missing result out — as .NET does for its Kafka and Event Hub triggers, where retaining
   * the record would replay the whole partition — passes `'acknowledge'` and documents it.
   */
  readonly missingResult?: MissingResultSettlement;
}

const unmatchedTopicMarker = Symbol.for('benzene.settlement.unmatchedTopic');

/**
 * Marks `result` as the router's answer for a topic no handler serves, so a binding can tell it apart from
 * a handler that itself returned `not-found` (a missing entity, which is an ordinary failure). The mark is
 * an invisible, non-enumerable property: it never reaches the wire.
 */
export function markUnmatchedTopic<TResult extends IBenzeneResult>(result: TResult): TResult {
  Object.defineProperty(result, unmatchedTopicMarker, { value: true, enumerable: false });
  return result;
}

/** Whether `result` is the router's answer for a topic no handler serves (see {@link markUnmatchedTopic}). */
export function isUnmatchedTopic(result: IMessageResult | IBenzeneResult | undefined | null): boolean {
  return (
    result !== undefined &&
    result !== null &&
    (result as unknown as Record<symbol, unknown>)[unmatchedTopicMarker] === true
  );
}

/**
 * Whether a one-way binding must decline the acknowledgement for this outcome, so the transport
 * redelivers the message: `isSuccessful: false`, or no result (unless `missingResult: 'acknowledge'`). An
 * unmatched topic is a failure unless `ignoreUnmatchedTopics`. The at-most-once override is the binding's
 * own short-circuit, before it asks.
 */
export function isSettledAsFailure(
  result: IMessageResult | IBenzeneResult | undefined | null,
  options: SettlementDecisionOptions = {},
): boolean {
  if (result === undefined || result === null) {
    return (options.missingResult ?? 'redeliver') === 'redeliver';
  }
  if (options.ignoreUnmatchedTopics === true && isUnmatchedTopic(result)) {
    return false;
  }
  return result.isSuccessful !== true;
}
