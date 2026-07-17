import { IServiceResolver } from '@benzene/abstractions';
import { IMiddleware, IMiddlewareFactory, IMiddlewareWrapper } from '@benzene/abstractions-middleware';

/**
 * Applies all registered middleware wrappers to each middleware instance.
 * Port of Benzene.Core.Middleware.DefaultMiddlewareFactory.
 */
export class DefaultMiddlewareFactory implements IMiddlewareFactory {
  constructor(private readonly middlewareWrappers: Iterable<IMiddlewareWrapper>) {}

  create<TContext>(
    serviceResolver: IServiceResolver,
    middleware: IMiddleware<TContext>,
  ): IMiddleware<TContext> {
    let result = middleware;
    for (const wrapper of this.middlewareWrappers) {
      result = wrapper.wrap(serviceResolver, result);
    }
    return result;
  }
}
