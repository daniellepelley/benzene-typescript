import { SettlementOptions } from '@benzenejs/core-message-handlers';

/**
 * How the function is invoked with the envelope — the AWS `InvocationType` of the caller's `Invoke`. The
 * platform does not reveal it to the function, so the application selects it (transport-bindings §1).
 */
export type BenzeneMessageInvocationType = 'RequestResponse' | 'Event';

/**
 * Configures the Lambda direct-invoke envelope surface (`useBenzeneMessage`).
 *
 * - `'RequestResponse'` (the default) — a **request/response** binding: the response envelope is returned
 *   to the caller, which reads the outcome from it. Nothing is settled.
 * - `'Event'` — the envelope delivered by an **asynchronous** invocation (`InvocationType: 'Event'`): there
 *   is no caller to answer, so it is a **one-shot** binding and settles by transport-bindings §1,
 *   obligation 8 — a failure result, a missing result or an uncaught error fails the invocation, and Lambda
 *   retries it (then its on-failure destination / DLQ). The settlement knobs apply only in this mode.
 *
 * TypeScript-only type: the .NET binding has no options; spec-0.2.0 makes the asynchronous envelope a
 * separately configured entry point because the invocation type cannot be detected at runtime.
 */
export class BenzeneMessageLambdaOptions implements SettlementOptions {
  /** How callers invoke this entry point. Defaults to `'RequestResponse'`. */
  invocationType: BenzeneMessageInvocationType = 'RequestResponse';

  /** See {@link SettlementOptions.atMostOnce} (`'Event'` mode only): never fail the invocation. */
  atMostOnce = false;

  /** See {@link SettlementOptions.ignoreUnmatchedTopics} (`'Event'` mode only). */
  ignoreUnmatchedTopics = false;
}
