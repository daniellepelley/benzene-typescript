import {
  IMessageHandlerDefinition,
  IMessageHandlersFinder,
} from '@benzene/abstractions-message-handlers';

/**
 * Caches the wrapped finder's results after the first call.
 * Port of Benzene.Core.MessageHandlers.CacheMessageHandlersFinder.
 */
export class CacheMessageHandlersFinder implements IMessageHandlersFinder {
  private messageHandlerDefinitions: IMessageHandlerDefinition[] | undefined;

  constructor(private readonly inner: IMessageHandlersFinder) {}

  findDefinitions(): IMessageHandlerDefinition[] {
    return (this.messageHandlerDefinitions ??= this.inner.findDefinitions());
  }
}
