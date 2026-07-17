import {
  IMessageHandlerDefinition,
  IMessageHandlersFinder,
} from '@benzene/abstractions-message-handlers';

/**
 * Finds handler definitions registered with the dependency injection container
 * (resolve them via `resolver.getServices(IMessageHandlerDefinition)`).
 * Port of Benzene.Core.MessageHandlers.DependencyMessageHandlersFinder.
 */
export class DependencyMessageHandlersFinder implements IMessageHandlersFinder {
  constructor(private readonly messageHandlerDefinitions: Iterable<IMessageHandlerDefinition>) {}

  findDefinitions(): IMessageHandlerDefinition[] {
    return [...this.messageHandlerDefinitions];
  }
}
