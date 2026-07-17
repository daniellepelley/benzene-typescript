import { IServiceResolverFactory } from '@benzene/abstractions';
import {
  IEntryPointMiddlewareApplication,
  IEntryPointMiddlewareApplicationWithResult,
  IMiddlewareApplication,
  IMiddlewareApplicationWithResult,
} from '@benzene/abstractions-middleware';

/**
 * Binds a middleware application to a resolver factory, forming a top-level entry point.
 * Port of Benzene.Core.Middleware.EntryPointMiddlewareApplication&lt;TEvent&gt;.
 */
export class EntryPointMiddlewareApplication<TEvent>
  implements IEntryPointMiddlewareApplication<TEvent>
{
  constructor(
    private readonly middlewareApplication: IMiddlewareApplication<TEvent>,
    private readonly serviceResolverFactory: IServiceResolverFactory,
  ) {}

  sendAsync(event: TEvent): Promise<void> {
    return this.middlewareApplication.handleAsync(event, this.serviceResolverFactory);
  }
}

/** Port of Benzene.Core.Middleware.EntryPointMiddlewareApplication&lt;TEvent, TResult&gt;. */
export class EntryPointMiddlewareApplicationWithResult<TEvent, TResult>
  implements IEntryPointMiddlewareApplicationWithResult<TEvent, TResult>
{
  constructor(
    private readonly middlewareApplication: IMiddlewareApplicationWithResult<TEvent, TResult>,
    private readonly serviceResolverFactory: IServiceResolverFactory,
  ) {}

  sendAsync(event: TEvent): Promise<TResult> {
    return this.middlewareApplication.handleAsync(event, this.serviceResolverFactory);
  }
}
