import {
  IHasMessageResult,
  IMessageHandlerResult,
  IMessageHandlerResultSetter,
} from '@benzenejs/abstractions-message-handlers';

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
    // The result itself, as .NET's `MessageHandlerResultSetterBase` records it — not a copy of its flag —
    // so a binding settling the message can read its status and tell an unmatched topic apart.
    context.messageResult = messageHandlerResult.benzeneResult;
    return Promise.resolve();
  }
}
