/** Port of Benzene.Extras.Broadcast.DependencyExtensions. */
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { IMessageDefinition, IMessageDefinitionFinder } from '@benzene/abstractions-messages';
import { IMessageRouterBuilder } from '@benzene/abstractions-message-handlers';
import { BroadcastEventChecker } from './BroadcastEventChecker';
import { BroadcastEventMiddlewareBuilder } from './BroadcastEventMiddlewareBuilder';
import { IBroadcastEventChecker } from './IBroadcastEventChecker';

/**
 * Registration helpers for broadcast events (C# extension methods → free functions).
 * Port of Benzene.Extras.Broadcast.DependencyExtensions.
 */

/**
 * Adds the broadcast-event middleware to every handler pipeline.
 * Port of C# `UseBroadcastEvent(this IMessageRouterBuilder)`.
 */
export function useBroadcastEvent(builder: IMessageRouterBuilder): IMessageRouterBuilder {
  return builder.add(new BroadcastEventMiddlewareBuilder());
}

/**
 * Registers the set of broadcastable event definitions (under both the {@link IBroadcastEventChecker}
 * token and the shared {@link IMessageDefinitionFinder} token, mirroring the C# double registration).
 * Port of C# `AddBroadcastEvent(this IBenzeneServiceContainer, params IMessageDefinition[])`.
 */
export function addBroadcastEvent(
  container: IBenzeneServiceContainer,
  ...messageDefinitions: IMessageDefinition[]
): IBenzeneServiceContainer {
  const broadcastEventChecker = new BroadcastEventChecker(...messageDefinitions);
  container.addSingletonInstance(IBroadcastEventChecker, broadcastEventChecker);
  container.addSingletonInstance(IMessageDefinitionFinder, broadcastEventChecker);
  return container;
}
