import {
  IMessageHandlerDefinition,
  IMessageHandlersFinder,
} from '@benzene/abstractions-message-handlers';

/**
 * Combines multiple finders into one.
 * Port of Benzene.Core.MessageHandlers.CompositeMessageHandlersFinder.
 */
export class CompositeMessageHandlersFinder implements IMessageHandlersFinder {
  private readonly inners: IMessageHandlersFinder[];

  constructor(...inners: IMessageHandlersFinder[]) {
    this.inners = inners;
  }

  findDefinitions(): IMessageHandlerDefinition[] {
    return this.inners.flatMap((inner) => inner.findDefinitions());
  }
}
