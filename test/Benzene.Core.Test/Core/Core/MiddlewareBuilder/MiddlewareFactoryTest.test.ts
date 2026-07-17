import { describe, expect, it } from 'vitest';
import { IServiceResolver } from '@benzene/abstractions';
import { IMiddleware, IMiddlewareWrapper, NextFunc } from '@benzene/abstractions-middleware';
import { FuncWrapperMiddleware, MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import {
  DefaultBenzeneServiceContainer,
  DefaultServiceResolverFactory,
  ServiceCollection,
} from '@benzene/dependencies';

/**
 * Verifies that registered IMiddlewareWrapper instances are applied to every
 * middleware via the DefaultMiddlewareFactory registered by addBenzeneMiddleware.
 */
class TestContext {
  trace: string[] = [];
}

class TracingWrapper implements IMiddlewareWrapper {
  wrap<TContext>(
    _serviceResolver: IServiceResolver,
    middleware: IMiddleware<TContext>,
  ): IMiddleware<TContext> {
    return new FuncWrapperMiddleware<TContext>(middleware.name, async (context, next: NextFunc) => {
      (context as unknown as TestContext).trace.push(`wrap:${middleware.name}:before`);
      await middleware.handleAsync(context, next);
      (context as unknown as TestContext).trace.push(`wrap:${middleware.name}:after`);
    });
  }
}

describe('MiddlewareFactoryTest', () => {
  it('MiddlewareWrapper_WrapsEveryMiddleware', async () => {
    const services = new ServiceCollection();
    const container = new DefaultBenzeneServiceContainer(services);
    container.addSingletonInstance(IMiddlewareWrapper, new TracingWrapper());

    const builder = new MiddlewarePipelineBuilder<TestContext>(container);
    builder.useFn('Inner', async (context, next) => {
      context.trace.push('inner');
      await next();
    });

    const factory = new DefaultServiceResolverFactory(services);
    const resolver = factory.createScope();

    const context = new TestContext();
    await builder.build().handleAsync(context, resolver);

    resolver.dispose();
    factory.dispose();

    expect(context.trace).toEqual(['wrap:Inner:before', 'inner', 'wrap:Inner:after']);
  });
});
