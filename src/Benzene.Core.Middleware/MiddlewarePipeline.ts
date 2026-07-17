import { IServiceResolver } from '@benzene/abstractions';
import {
  IMiddlewareFactory,
  IMiddlewarePipeline,
  MiddlewareFactoryFunc,
  NextFunc,
} from '@benzene/abstractions-middleware';
import { DefaultMiddlewareFactory } from './DefaultMiddlewareFactory';

/**
 * The executable middleware chain.
 * Port of Benzene.Core.Middleware.MiddlewarePipeline&lt;TContext&gt;.
 */
export class MiddlewarePipeline<TContext> implements IMiddlewarePipeline<TContext> {
  // Reversed once at construction (order never changes after that) instead of
  // re-reversing on every handleAsync call, matching the C# implementation.
  private readonly reversedItems: MiddlewareFactoryFunc<TContext>[];

  constructor(items: MiddlewareFactoryFunc<TContext>[]) {
    this.reversedItems = [...items].reverse();
  }

  handleAsync(context: TContext, serviceResolver: IServiceResolver): Promise<void> {
    const chain = this.createChain(context, serviceResolver);
    return chain();
  }

  private createChain(context: TContext, serviceResolver: IServiceResolver): NextFunc {
    const factory = MiddlewarePipeline.getMiddlewareFactory(serviceResolver);

    return this.reversedItems.reduce<NextFunc>((current, middleware) => {
      const instance = factory.create(serviceResolver, middleware(serviceResolver));
      return () => instance.handleAsync(context, current);
    }, () => Promise.resolve());
  }

  private static getMiddlewareFactory(serviceResolver: IServiceResolver): IMiddlewareFactory {
    return serviceResolver.tryGetService(IMiddlewareFactory) ?? new DefaultMiddlewareFactory([]);
  }
}
