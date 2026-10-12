import { PutEventsCommandInput, PutEventsCommandOutput } from '@aws-sdk/client-eventbridge';

/**
 * The middleware pipeline context for putting a single event to EventBridge.
 * Port of Benzene.Clients.Aws.EventBridge.EventBridgeSendMessageContext (`PutEventsRequest`/`PutEventsResponse`
 * -> the `@aws-sdk/client-eventbridge` v3 command input/output types).
 */
export class EventBridgeSendMessageContext {
  /** The EventBridge PutEvents response, set by `EventBridgeClientMiddleware`. */
  response?: PutEventsCommandOutput;

  /**
   * Set instead of a completed send when the SDK call rejected before the broker accepted the message; the
   * outbound converter turns it into a failed result (`failedSendResult`, transport-bindings.md §1) rather
   * than letting the exception escape the send. A port addition.
   */
  transportFailure?: unknown;

  constructor(readonly request: PutEventsCommandInput) {}
}
