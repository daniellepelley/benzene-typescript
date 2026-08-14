import { ServiceToken, serviceToken } from '@benzenejs/abstractions';
import { IMessageBodyGetter, IMessageHeadersGetter } from '@benzenejs/abstractions-messages';
import { IMessageTopicGetter } from './IMessageTopicGetter';

/**
 * Convenience aggregate of the three pieces of a transport's incoming message a router needs to
 * extract before it can dispatch: body, headers, and topic.
 * Port of Benzene.Abstractions.MessageHandlers.Mappers.IMessageGetter&lt;TContext&gt;.
 */
export interface IMessageGetter<TContext>
  extends IMessageBodyGetter<TContext>,
    IMessageHeadersGetter<TContext>,
    IMessageTopicGetter<TContext> {}

export const IMessageGetter: ServiceToken<IMessageGetter<unknown>> =
  serviceToken<IMessageGetter<unknown>>('IMessageGetter');
