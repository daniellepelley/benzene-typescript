/** Port of Benzene.Diagnostics.DebugMiddlewareWrapper. */
import { IServiceResolver } from '@benzene/abstractions';
import { IMiddleware, IMiddlewareWrapper } from '@benzene/abstractions-middleware';
import { DebugMiddlewareDecorator } from './DebugMiddlewareDecorator';

/**
 * An {@link IMiddlewareWrapper} that decorates every middleware with a
 * {@link DebugMiddlewareDecorator}, emitting start/complete debug output around it.
 * Port of Benzene.Diagnostics.DebugMiddlewareWrapper.
 */
export class DebugMiddlewareWrapper implements IMiddlewareWrapper {
  wrap<TContext>(
    serviceResolver: IServiceResolver,
    middleware: IMiddleware<TContext>,
  ): IMiddleware<TContext> {
    return new DebugMiddlewareDecorator<TContext>(middleware);
  }
}
