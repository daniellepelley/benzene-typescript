import { IMessageSenderDefinition, IMessageSendersFinder } from '@benzenejs/abstractions-messages';

/**
 * Finds outbound sender definitions registered with the dependency injection container (resolve them
 * via `resolver.getServices(IMessageSenderDefinition)`) - the sender-side counterpart of
 * `Benzene.Core.MessageHandlers`' `DependencyMessageHandlersFinder`, mirroring inbound handler
 * discovery (core-concepts.md §9) for outbound registration (mesh.md §2.3): an application registers
 * an `IMessageSenderDefinition` instance per topic it may send (no handler, since nothing here
 * receives), and this finder collects them for `MeshDescriptorFactory.create`'s `consumes` projection.
 */
export class DependencyMessageSendersFinder implements IMessageSendersFinder {
  constructor(private readonly messageSenderDefinitions: Iterable<IMessageSenderDefinition>) {}

  findDefinitions(): IMessageSenderDefinition[] {
    return [...this.messageSenderDefinitions];
  }
}
