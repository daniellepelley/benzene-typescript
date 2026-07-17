import { IServiceResolver } from '@benzene/abstractions';
import { IMiddleware } from '@benzene/abstractions-middleware';
import { IMessageHandler } from './IMessageHandler';
import { IMessageHandlerContext } from './IBenzeneMessageContext';

/**
 * Factory for a single piece of handler middleware, registered with an `IMessageRouterBuilder` so
 * `IHandlerPipelineBuilder` can include it in every handler pipeline it builds (e.g. cross-cutting
 * concerns such as validation, logging enrichment, or filters).
 * Port of Benzene.Abstractions.MessageHandlers.IHandlerMiddlewareBuilder.
 */
export interface IHandlerMiddlewareBuilder {
  /**
   * Creates the middleware instance for a specific handler invocation, or `undefined` if this
   * builder has nothing to contribute for the given request/response pair (in which case
   * `IHandlerPipelineBuilder` skips it).
   * Port of C# `Create<TRequest, TResponse>`; C# `null` maps to `undefined`.
   */
  create<TRequest, TResponse>(
    serviceResolver: IServiceResolver,
    messageHandler: IMessageHandler<TRequest, TResponse>,
  ): IMiddleware<IMessageHandlerContext<TRequest, TResponse>> | undefined;
}
