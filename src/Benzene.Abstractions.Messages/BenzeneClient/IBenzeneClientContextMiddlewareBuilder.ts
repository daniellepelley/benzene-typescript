import { IServiceResolver, ServiceToken, serviceToken } from '@benzene/abstractions';
import { IMiddleware } from '@benzene/abstractions-middleware';
import { IBenzeneClientContext } from './IBenzeneClientContext';

/**
 * Builds an optional client-pipeline middleware for a given request/response pair (e.g. outbound
 * validation), resolved from the container.
 * Port of Benzene.Abstractions.Messages.BenzeneClient.IBenzeneClientContextMiddlewareBuilder.
 *
 * The C# `where TRequest : class` constraint has no TypeScript equivalent and is dropped; C# `null`
 * (no middleware) maps to `undefined`.
 */
export interface IBenzeneClientContextMiddlewareBuilder {
  /** Port of C# `IMiddleware<IBenzeneClientContext<TRequest, TResponse>>? Create<TRequest, TResponse>(IServiceResolver)`. */
  create<TRequest, TResponse>(
    serviceResolver: IServiceResolver,
  ): IMiddleware<IBenzeneClientContext<TRequest, TResponse>> | undefined;
}

export const IBenzeneClientContextMiddlewareBuilder: ServiceToken<IBenzeneClientContextMiddlewareBuilder> =
  serviceToken<IBenzeneClientContextMiddlewareBuilder>('IBenzeneClientContextMiddlewareBuilder');
