import { IServiceResolver, ServiceToken, serviceToken } from '@benzene/abstractions';
import { IMiddleware } from './IMiddleware';

/**
 * Factory for creating middleware instances, enabling wrapping with cross-cutting
 * behavior (logging, metrics, exception handling) and DI integration.
 * Port of Benzene.Abstractions.Middleware.IMiddlewareFactory.
 */
export interface IMiddlewareFactory {
  /** Creates a middleware instance, potentially wrapping or enhancing the provided middleware. */
  create<TContext>(
    serviceResolver: IServiceResolver,
    middleware: IMiddleware<TContext>,
  ): IMiddleware<TContext>;
}

export const IMiddlewareFactory: ServiceToken<IMiddlewareFactory> =
  serviceToken<IMiddlewareFactory>('IMiddlewareFactory');
