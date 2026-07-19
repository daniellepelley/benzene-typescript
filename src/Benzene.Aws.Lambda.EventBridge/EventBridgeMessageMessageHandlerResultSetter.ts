/** Port of Benzene.Aws.Lambda.EventBridge.EventBridgeMessageMessageHandlerResultSetter. */
import { MessageMessageHandlerResultSetterBase } from '@benzene/core-message-handlers';
import { EventBridgeContext } from './EventBridgeContext';

/**
 * Records the handler outcome on the context. EventBridge target invocations are fire-and-forget, so — like
 * SNS/S3 — there is no response body to write, only the message result.
 *
 * C# `EventBridgeMessageMessageHandlerResultSetter : MessageMessageHandlerResultSetterBase<EventBridgeContext>`
 * (an empty body) ports to a trivial subclass of the already-ported base.
 */
export class EventBridgeMessageMessageHandlerResultSetter extends MessageMessageHandlerResultSetterBase<EventBridgeContext> {}
