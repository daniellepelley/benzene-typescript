import { IServiceResolver, IServiceResolverFactory } from '@benzene/abstractions';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';

/**
 * Base class for middleware that extract a request from the context and either
 * handle it or pass control to the rest of the pipeline.
 * Port of Benzene.Core.Middleware.MiddlewareRouter&lt;TRequest, TContext&gt;.
 */
export abstract class MiddlewareRouter<TRequest, TContext> implements IMiddleware<TContext> {
  readonly name: string = 'MiddlewareRouter';

  constructor(private readonly serviceResolver: IServiceResolver) {}

  async handleAsync(context: TContext, next: NextFunc): Promise<void> {
    const request = this.tryExtractRequest(context);

    if (request === undefined || request === null) {
      await next();
      return;
    }

    if (this.canHandle(request)) {
      await this.handleFunction(
        request,
        context,
        this.serviceResolver.getService(IServiceResolverFactory),
      );
    } else {
      await next();
    }
  }

  protected abstract canHandle(request: TRequest): boolean;

  protected abstract handleFunction(
    request: TRequest,
    context: TContext,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void>;

  protected abstract tryExtractRequest(context: TContext): TRequest | undefined;
}
