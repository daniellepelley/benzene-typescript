import { IServiceResolver } from '@benzene/abstractions';
import {
  IHandlerMiddlewareBuilder,
  IMessageHandler,
  IMessageHandlerContext,
} from '@benzene/abstractions-message-handlers';
import { IMiddleware } from '@benzene/abstractions-middleware';
import { ResponseEventMappings } from './ResponseEventMappings';
import { ResponseEventsMiddleware } from './ResponseEventsMiddleware';

/**
 * {@link IHandlerMiddlewareBuilder} that contributes a {@link ResponseEventsMiddleware} carrying one
 * pipeline's {@link ResponseEventMappings} to every handler pipeline built for that transport pipeline.
 * Port of Benzene.ResponseEvents.ResponseEventsMiddlewareBuilder.
 */
export class ResponseEventsMiddlewareBuilder implements IHandlerMiddlewareBuilder {
  private readonly mappings: ResponseEventMappings;

  constructor(mappings: ResponseEventMappings) {
    this.mappings = mappings;
  }

  create<TRequest, TResponse>(
    serviceResolver: IServiceResolver,
    _messageHandler: IMessageHandler<TRequest, TResponse>,
  ): IMiddleware<IMessageHandlerContext<TRequest, TResponse>> | undefined {
    return new ResponseEventsMiddleware<TRequest, TResponse>(this.mappings, serviceResolver);
  }
}
