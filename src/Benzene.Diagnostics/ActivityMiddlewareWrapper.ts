import { IServiceResolver } from '@benzene/abstractions';
import { IMiddleware, IMiddlewareWrapper } from '@benzene/abstractions-middleware';
import { ActivityMiddlewareDecorator } from './ActivityMiddlewareDecorator';

/**
 * Wraps every middleware in the pipeline in an {@link ActivityMiddlewareDecorator}, starting a span per
 * pipeline stage. Registered by `addActivityPerMiddleware`/`addDiagnostics`.
 * Port of Benzene.Diagnostics.ActivityMiddlewareWrapper.
 */
export class ActivityMiddlewareWrapper implements IMiddlewareWrapper {
  wrap<TContext>(
    serviceResolver: IServiceResolver,
    middleware: IMiddleware<TContext>,
  ): IMiddleware<TContext> {
    return new ActivityMiddlewareDecorator<TContext>(middleware, serviceResolver);
  }
}
