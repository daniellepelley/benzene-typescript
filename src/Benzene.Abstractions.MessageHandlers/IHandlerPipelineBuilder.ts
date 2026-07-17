import { IServiceResolver, ServiceToken, serviceToken } from '@benzene/abstractions';
import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { IMessageHandler } from './IMessageHandler';
import { IMessageHandlerContext } from './IBenzeneMessageContext';
import { IHandlerMiddlewareBuilder } from './IHandlerMiddlewareBuilder';

/**
 * Builds the per-handler middleware pipeline (over `IMessageHandlerContext<TRequest, TResponse>`)
 * that wraps a message handler with the middleware contributed by every registered
 * `IHandlerMiddlewareBuilder`, finishing with the handler invocation itself.
 * Port of Benzene.Abstractions.MessageHandlers.IHandlerPipelineBuilder.
 */
export interface IHandlerPipelineBuilder {
  /**
   * Registers additional `IHandlerMiddlewareBuilder` instances to be included in every pipeline
   * created by this builder from now on. Port of C# `Add(params IHandlerMiddlewareBuilder[])`.
   */
  add(...routerMiddlewareBuilders: IHandlerMiddlewareBuilder[]): void;

  /**
   * Builds the middleware pipeline for a specific handler by asking every registered
   * `IHandlerMiddlewareBuilder` to contribute middleware, then appending the handler invocation
   * itself as the final step. Port of C# `Create<TRequest, TResponse>`.
   */
  create<TRequest, TResponse>(
    messageHandler: IMessageHandler<TRequest, TResponse>,
    serviceResolver: IServiceResolver,
  ): IMiddlewarePipeline<IMessageHandlerContext<TRequest, TResponse>>;
}

export const IHandlerPipelineBuilder: ServiceToken<IHandlerPipelineBuilder> =
  serviceToken<IHandlerPipelineBuilder>('IHandlerPipelineBuilder');
