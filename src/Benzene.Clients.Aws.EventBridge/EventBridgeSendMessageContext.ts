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
   * The caller's abort signal for this send, if any — copied from `OutboundContext.signal` by the
   * converter and passed to the SDK call as `abortSignal` (the TS-idiomatic port of the ambient
   * `ICancellationTokenAccessor` token the .NET middleware threads into `PutEventsAsync`).
   */
  signal?: AbortSignal;

  constructor(readonly request: PutEventsCommandInput) {}
}
