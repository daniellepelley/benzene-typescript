/** Port of Benzene.Aws.Lambda.EventBridge.EventBridgeMessageProcessingException. */

/**
 * Thrown by `EventBridgeApplication` when `EventBridgeOptions.raiseOnFailureStatus` is enabled (the
 * default) and the event was not processed successfully — a failure result, or none — escalating it so
 * the rule target's retry policy applies as it would for an unhandled exception.
 */
export class EventBridgeMessageProcessingException extends Error {
  /** The EventBridge event id. */
  readonly eventId: string | undefined;

  constructor(eventId: string | undefined, detailType: string | undefined) {
    super(
      `EventBridge event ${eventId ?? '<no id>'} ('${detailType ?? '<no detail-type>'}') was not processed ` +
        'successfully (a failure result, no result, or a detail-type no handler serves); failing the invocation ' +
        'so EventBridge retries it. Set ignoreUnmatchedTopics when the rule matches other event types, or ' +
        'atMostOnce to acknowledge failures.',
    );
    this.name = 'EventBridgeMessageProcessingException';
    this.eventId = eventId;
  }
}
