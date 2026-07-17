import { IServiceResolver } from '@benzene/abstractions';
import {
  IContextConverter,
  IMiddleware,
  IMiddlewarePipeline,
  NextFunc,
} from '@benzene/abstractions-middleware';

/**
 * Converts the context to a different type, runs an inner pipeline against it and
 * maps results back. Port of Benzene.Core.Middleware.ContextConverterMiddleware&lt;TContext, TContextOut&gt;.
 */
export class ContextConverterMiddleware<TContext, TContextOut> implements IMiddleware<TContext> {
  readonly name = 'Convert';

  constructor(
    private readonly converter: IContextConverter<TContext, TContextOut>,
    private readonly middlewarePipeline: IMiddlewarePipeline<TContextOut>,
    private readonly serviceResolver: IServiceResolver,
  ) {}

  async handleAsync(context: TContext, _next: NextFunc): Promise<void> {
    const contextOut = await this.converter.createRequestAsync(context);
    await this.middlewarePipeline.handleAsync(contextOut, this.serviceResolver);
    await this.converter.mapResponseAsync(context, contextOut);
  }
}
