import {
  IHasMessageResult,
  IMessageHandlerResult,
  IMessageHandlerResultSetter,
} from '@benzene/abstractions-message-handlers';
import { MessageResult } from './MessageResult';

/**
 * Base `IMessageHandlerResultSetter<TContext>` implementation for transports whose context carries
 * its own simple pass/fail completion outcome via `IHasMessageResult.messageResult` (e.g. so a
 * queue/trigger-based transport can decide whether to acknowledge or retry the message), rather than
 * writing a response body back through the response adapter.
 * Port of Benzene.Core.MessageHandlers.MessageMessageHandlerResultSetterBase&lt;TContext&gt;.
 */
export abstract class MessageMessageHandlerResultSetterBase<TContext extends IHasMessageResult>
  implements IMessageHandlerResultSetter<TContext>
{
  setResultAsync(context: TContext, messageHandlerResult: IMessageHandlerResult): Promise<void> {
    context.messageResult = new MessageResult(messageHandlerResult.benzeneResult.isSuccessful);
    return Promise.resolve();
  }
}
