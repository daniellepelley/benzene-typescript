import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { ITopic } from '@benzene/abstractions-messages';
import { IMessageHandler, IMessageHandlerNoResponse } from './IMessageHandler';

/**
 * Wraps resolved message handlers with additional behavior (decorator pattern).
 * Port of Benzene.Abstractions.MessageHandlers.IMessageHandlerWrapper.
 * The two C# `Wrap` overloads split by name (`wrap` / `wrapNoResponse`) because
 * the handler shapes are indistinguishable at JavaScript runtime.
 */
export interface IMessageHandlerWrapper {
  wrap<TRequest, TResponse>(
    topic: ITopic,
    messageHandler: IMessageHandler<TRequest, TResponse>,
  ): IMessageHandler<TRequest, TResponse>;

  wrapNoResponse<TRequest, TResponse>(
    topic: ITopic,
    messageHandler: IMessageHandlerNoResponse<TRequest>,
  ): IMessageHandler<TRequest, TResponse>;
}

export const IMessageHandlerWrapper: ServiceToken<IMessageHandlerWrapper> =
  serviceToken<IMessageHandlerWrapper>('IMessageHandlerWrapper');
