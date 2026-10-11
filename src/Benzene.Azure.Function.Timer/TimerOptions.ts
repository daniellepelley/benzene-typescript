/** Port of Benzene.Azure.Function.Timer.TimerOptions. */
import { SettlementOptions } from '@benzenejs/core-message-handlers';

/**
 * Configures how `TimerApplication` settles a tick (transport-bindings §1, obligation 8) — a **one-shot**
 * binding: a failure fails the invocation, and the Functions host's retry policy (if the application
 * configures one) decides whether the tick is retried; otherwise the next occurrence runs on schedule and
 * the failure is at least visible as a failed invocation.
 *
 * Defaults: a **failure result** (from `usePresetTopic(...)` + message-handler dispatch) and an **uncaught
 * exception** fail the invocation. A **missing result** is not a failure here, as in .NET: a tick consumed
 * directly with `useTick(...)` never records one, so escalating it would fail every plain tick. An
 * unmatched preset topic is a failure unless `ignoreUnmatchedTopics`.
 */
export class TimerOptions implements SettlementOptions {
  /** Whether an uncaught exception is caught (logged; the invocation succeeds). Defaults to `false`. */
  catchExceptions = false;

  /**
   * Whether a failure result is escalated into a thrown `TimerMessageProcessingException`, failing the
   * invocation. Defaults to `true` (.NET's default).
   */
  raiseOnFailureStatus = true;

  /** See {@link SettlementOptions.atMostOnce}: never fail the invocation, whatever the outcome. */
  atMostOnce = false;

  /** See {@link SettlementOptions.ignoreUnmatchedTopics}: a preset topic no handler serves is not a failure. */
  ignoreUnmatchedTopics = false;
}
