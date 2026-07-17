import { IServiceResolver, ServiceToken, serviceToken } from '@benzene/abstractions';
import { IMiddleware } from './IMiddleware';

/**
 * Wraps middleware instances with additional behavior (decorator pattern) —
 * exception handling, logging, metrics, security checks.
 * Port of Benzene.Abstractions.Middleware.IMiddlewareWrapper.
 */
export interface IMiddlewareWrapper {
  /** Wraps the specified middleware with additional functionality. */
  wrap<TContext>(
    serviceResolver: IServiceResolver,
    middleware: IMiddleware<TContext>,
  ): IMiddleware<TContext>;
}

export const IMiddlewareWrapper: ServiceToken<IMiddlewareWrapper> =
  serviceToken<IMiddlewareWrapper>('IMiddlewareWrapper');
