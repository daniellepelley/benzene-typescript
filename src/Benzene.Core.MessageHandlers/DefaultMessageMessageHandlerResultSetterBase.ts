import {
  IMessageHandlerResult,
  IMessageHandlerResultSetter,
} from '@benzene/abstractions-message-handlers';

/**
 * No-op `IMessageHandlerResultSetter<TContext>` base class for transports that don't need to report
 * a handler's outcome back onto the context at all (e.g. because the transport's own
 * trigger/consumer handles acknowledgement automatically, regardless of success or failure).
 * Port of Benzene.Core.MessageHandlers.DefaultMessageMessageHandlerResultSetterBase&lt;TContext&gt;.
 */
export abstract class DefaultMessageMessageHandlerResultSetterBase<TContext>
  implements IMessageHandlerResultSetter<TContext>
{
  setResultAsync(_context: TContext, _messageHandlerResult: IMessageHandlerResult): Promise<void> {
    return Promise.resolve();
  }
}
