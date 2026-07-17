import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { ITopic } from '@benzene/abstractions-messages';

/**
 * Extracts the routing topic from a transport-specific message context, so a router can look up
 * the registered handler via `IMessageHandlerDefinitionLookUp`.
 * Port of Benzene.Abstractions.MessageHandlers.Mappers.IMessageTopicGetter&lt;TContext&gt;.
 */
export interface IMessageTopicGetter<TContext> {
  /** Port of C# `ITopic? GetTopic(TContext)`; C# `null` maps to `undefined`. */
  getTopic(context: TContext): ITopic | undefined;
}

export const IMessageTopicGetter: ServiceToken<IMessageTopicGetter<unknown>> =
  serviceToken<IMessageTopicGetter<unknown>>('IMessageTopicGetter');
