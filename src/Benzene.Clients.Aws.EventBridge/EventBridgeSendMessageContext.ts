import { PutEventsCommandInput, PutEventsCommandOutput } from '@aws-sdk/client-eventbridge';

/**
 * The middleware pipeline context for putting a single event to EventBridge.
 * Port of Benzene.Clients.Aws.EventBridge.EventBridgeSendMessageContext (`PutEventsRequest`/`PutEventsResponse`
 * -> the `@aws-sdk/client-eventbridge` v3 command input/output types).
 */
export class EventBridgeSendMessageContext {
  /** The EventBridge PutEvents response, set by `EventBridgeClientMiddleware`. */
  response?: PutEventsCommandOutput;

  constructor(readonly request: PutEventsCommandInput) {}
}
