/** Port of Benzene.GoogleCloud.Functions.PubSub.PubSubMessageHandlerResultSetter. */
import { MessageMessageHandlerResultSetterBase } from '@benzenejs/core-message-handlers';
import { PubSubContext } from './PubSubContext';

/**
 * Records a message handler's outcome onto `PubSubContext.messageResult`. The Functions Framework has no
 * platform-level per-message acknowledgement to report back to beyond "did the handler throw", but
 * `PubSubMiddlewareApplication` reads this to support `PubSubOptions.raiseOnFailureStatus`.
 *
 * C# `MessageHandlerResultSetterBase<PubSubContext>` (an empty body) ports to a trivial subclass of the
 * already-ported base (the TypeScript name is `MessageMessageHandlerResultSetterBase`, matching the other
 * ported triggers — e.g. `ServiceBusMessageMessageHandlerResultSetter`).
 */
export class PubSubMessageHandlerResultSetter extends MessageMessageHandlerResultSetterBase<PubSubContext> {}
