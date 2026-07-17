import { ILogger } from '@benzene/abstractions';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';

/**
 * Catches unhandled errors from the rest of the pipeline, logs them and invokes a
 * caller-supplied handler. Port of Benzene.Core.Middleware.ExceptionHandlerMiddleware&lt;TContext&gt;.
 */
export class ExceptionHandlerMiddleware<TContext> implements IMiddleware<TContext> {
  readonly name = 'ExceptionHandler';

  constructor(
    private readonly onException: (context: TContext, error: unknown) => void,
    private readonly logger: ILogger,
  ) {}

  async handleAsync(context: TContext, next: NextFunc): Promise<void> {
    try {
      await next();
    } catch (error) {
      this.logger.logError(error, 'Unhandled exception caught in middleware pipeline');
      this.onException(context, error);
    }
  }
}
