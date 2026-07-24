/**
 * What {@link ResponseEventsMiddleware} does when publishing a response event fails (the publisher
 * throws, or returns an unsuccessful result).
 * Port of Benzene.ResponseEvents.PublishFailureMode.
 */
export enum PublishFailureMode {
  /**
   * Replace the handler's response with an `UnexpectedError` result, so the transport reports the
   * message as failed and (for queue transports) redelivers it. This is honest at-least-once delivery:
   * the handler and the event's consumers must be idempotent, because a redelivered message re-runs the
   * handler. The default.
   */
  FailMessage = 0,

  /**
   * Log a warning and keep the handler's response - the message is acknowledged even though the event
   * was lost. For pipelines where the follow-up event is best-effort.
   */
  LogAndContinue = 1,
}
