/** Port of Benzene.Extras.Broadcast.BroadcastEventMiddlewareBuilder. */
import { IServiceResolver } from '@benzene/abstractions';
import {
  IHandlerMiddlewareBuilder,
  IMessageHandler,
  IMessageHandlerContext,
} from '@benzene/abstractions-message-handlers';
import { IMiddleware } from '@benzene/abstractions-middleware';
import { BroadcastEventMiddleware } from './BroadcastEventMiddleware';

/**
 * {@link IHandlerMiddlewareBuilder} that contributes a {@link BroadcastEventMiddleware} to every
 * handler pipeline.
 * Port of Benzene.Extras.Broadcast.BroadcastEventMiddlewareBuilder.
 */
export class BroadcastEventMiddlewareBuilder implements IHandlerMiddlewareBuilder {
  create<TRequest, TResponse>(
    serviceResolver: IServiceResolver,
    _messageHandler: IMessageHandler<TRequest, TResponse>,
  ): IMiddleware<IMessageHandlerContext<TRequest, TResponse>> {
    return new BroadcastEventMiddleware<TRequest, TResponse>(serviceResolver);
  }
}
