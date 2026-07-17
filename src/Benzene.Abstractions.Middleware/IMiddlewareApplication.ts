import { IServiceResolverFactory } from '@benzene/abstractions';

/**
 * A middleware application that processes events without returning a result
 * (message queue processing, fire-and-forget operations). The application creates
 * the appropriate context, executes the pipeline and manages the resolver scope.
 * Port of Benzene.Abstractions.Middleware.IMiddlewareApplication&lt;TEvent&gt;.
 */
export interface IMiddlewareApplication<TEvent> {
  handleAsync(event: TEvent, serviceResolverFactory: IServiceResolverFactory): Promise<void>;
}

/**
 * A middleware application that processes requests and returns a response
 * (HTTP handling, RPC, request/reply messaging).
 * Port of C# `IMiddlewareApplication<TRequest, TResponse>` (renamed with a
 * `WithResult` suffix since TypeScript cannot overload a type name on arity).
 */
export interface IMiddlewareApplicationWithResult<TRequest, TResponse> {
  handleAsync(event: TRequest, serviceResolverFactory: IServiceResolverFactory): Promise<TResponse>;
}
