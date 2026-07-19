/** Port of Benzene.Extras.Broadcast.IBroadcastEventChecker. */
import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { IMessageDefinition, IMessageDefinitionFinder } from '@benzene/abstractions-messages';

/**
 * Decides whether a given (topic, payload) pair corresponds to a registered broadcastable event, and
 * exposes the registered definitions as an {@link IMessageDefinitionFinder}.
 * Port of Benzene.Extras.Broadcast.IBroadcastEventChecker.
 */
export interface IBroadcastEventChecker extends IMessageDefinitionFinder<IMessageDefinition> {
  /** Port of C# `bool Check<T>(string topic, T payload)`. */
  check<T>(topic: string, payload: T): boolean;
}

export const IBroadcastEventChecker: ServiceToken<IBroadcastEventChecker> =
  serviceToken<IBroadcastEventChecker>('IBroadcastEventChecker');
