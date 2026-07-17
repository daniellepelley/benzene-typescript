import { IServiceResolver } from '@benzene/abstractions';
import {
  IHandlerMiddlewareBuilder,
  IHandlerPipelineBuilder,
  IMessageHandler,
  IMessageHandlerContext,
} from '@benzene/abstractions-message-handlers';
import { IMiddleware, IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { MiddlewarePipeline } from '@benzene/core-middleware';
import { MessageHandlerMiddleware } from './MessageHandlerMiddleware';

/**
 * Default `IHandlerPipelineBuilder` implementation: assembles a handler's middleware pipeline from
 * every registered `IHandlerMiddlewareBuilder` (e.g. filters), followed by a terminal
 * `MessageHandlerMiddleware<TRequest, TResponse>` that invokes the handler itself.
 * Port of Benzene.Core.MessageHandlers.HandlerPipelineBuilder.
 */
export class HandlerPipelineBuilder implements IHandlerPipelineBuilder {
  private readonly routerMiddlewareBuilders: IHandlerMiddlewareBuilder[];

  constructor(routerMiddlewareBuilders: readonly IHandlerMiddlewareBuilder[]) {
    this.routerMiddlewareBuilders = [...routerMiddlewareBuilders];
  }

  add(...routerMiddlewareBuilders: IHandlerMiddlewareBuilder[]): void {
    this.routerMiddlewareBuilders.push(...routerMiddlewareBuilders);
  }

  create<TRequest, TResponse>(
    messageHandler: IMessageHandler<TRequest, TResponse>,
    serviceResolver: IServiceResolver,
  ): IMiddlewarePipeline<IMessageHandlerContext<TRequest, TResponse>> {
    const items: IMiddleware<IMessageHandlerContext<TRequest, TResponse>>[] = [];
    for (const routerMiddlewareBuilder of this.routerMiddlewareBuilders) {
      if (routerMiddlewareBuilder === undefined || routerMiddlewareBuilder === null) {
        continue;
      }

      const middleware = routerMiddlewareBuilder.create(serviceResolver, messageHandler);
      if (middleware !== undefined && middleware !== null) {
        items.push(middleware);
      }
    }

    items.push(new MessageHandlerMiddleware<TRequest, TResponse>(messageHandler));

    return new MiddlewarePipeline<IMessageHandlerContext<TRequest, TResponse>>(
      items.map((x) => () => x),
    );
  }
}
