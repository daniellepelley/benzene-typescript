import { describe, expect, it } from 'vitest';
import { IServiceResolver, IServiceResolverFactory } from '@benzene/abstractions';
import {
  EntryPointMiddlewareApplicationWithResult,
  MiddlewareApplication,
  MiddlewareApplicationWithResult,
  MiddlewareMultiApplicationWithResult,
  MiddlewarePipelineBuilder,
} from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer, ServiceCollection } from '@benzene/dependencies';

/**
 * Port of Benzene.Test.Core.Middleware.MiddlewareApplicationScopeDisposalTest and
 * Benzene.Test.Core.Core.MiddlewareBuilder.MiddlewareMultiApplicationTest scenarios.
 */
class TestEvent {
  constructor(public readonly payload: string) {}
}

class TestContext {
  response: string | undefined;

  constructor(public readonly payload: string) {}
}

class TrackingServiceResolverFactory implements IServiceResolverFactory {
  readonly scopes: TrackingServiceResolver[] = [];

  constructor(private readonly inner: IServiceResolverFactory) {}

  createScope(): IServiceResolver {
    const scope = new TrackingServiceResolver(this.inner.createScope());
    this.scopes.push(scope);
    return scope;
  }

  dispose(): void {
    this.inner.dispose();
  }
}

class TrackingServiceResolver implements IServiceResolver {
  disposed = false;

  constructor(private readonly inner: IServiceResolver) {}

  getService<T>(identifier: import('@benzene/abstractions').ServiceIdentifier<T>): T {
    return this.inner.getService(identifier);
  }

  tryGetService<T>(identifier: import('@benzene/abstractions').ServiceIdentifier<T>): T | undefined {
    return this.inner.tryGetService(identifier);
  }

  getServices<T>(identifier: import('@benzene/abstractions').ServiceIdentifier<T>): T[] {
    return this.inner.getServices(identifier);
  }

  dispose(): void {
    this.disposed = true;
    this.inner.dispose();
  }
}

function createPipeline() {
  const services = new ServiceCollection();
  const container = new DefaultBenzeneServiceContainer(services);
  const builder = new MiddlewarePipelineBuilder<TestContext>(container);
  builder.onRequest((context) => {
    context.response = `handled:${context.payload}`;
  });
  return { pipeline: builder.build(), container };
}

describe('MiddlewareApplicationTest', () => {
  it('MiddlewareApplication_WithResult_MapsEventAndResult', async () => {
    const { pipeline, container } = createPipeline();

    const application = new MiddlewareApplicationWithResult<TestEvent, TestContext, string>(
      pipeline,
      (event) => new TestContext(event.payload),
      (context) => context.response ?? '',
    );

    const factory = new TrackingServiceResolverFactory(container.createServiceResolverFactory());
    const result = await application.handleAsync(new TestEvent('foo'), factory);

    expect(result).toBe('handled:foo');
    expect(factory.scopes).toHaveLength(1);
    expect(factory.scopes[0].disposed).toBe(true);
  });

  it('MiddlewareApplication_DisposesScope_WhenPipelineThrows', async () => {
    const services = new ServiceCollection();
    const container = new DefaultBenzeneServiceContainer(services);
    const builder = new MiddlewarePipelineBuilder<TestContext>(container);
    builder.useFn(() => {
      throw new Error('Test');
    });

    const application = new MiddlewareApplication<TestEvent, TestContext>(
      builder.build(),
      (event) => new TestContext(event.payload),
    );

    const factory = new TrackingServiceResolverFactory(container.createServiceResolverFactory());
    await expect(application.handleAsync(new TestEvent('foo'), factory)).rejects.toThrow('Test');

    expect(factory.scopes).toHaveLength(1);
    expect(factory.scopes[0].disposed).toBe(true);
  });

  it('MiddlewareMultiApplication_HandlesEachContextInItsOwnScope', async () => {
    const { pipeline, container } = createPipeline();

    const application = new MiddlewareMultiApplicationWithResult<TestEvent, TestContext, string>(
      pipeline,
      (event) => event.payload.split(',').map((part) => new TestContext(part)),
      (context) => context.response ?? '',
    );

    const factory = new TrackingServiceResolverFactory(container.createServiceResolverFactory());
    const results = await application.handleAsync(new TestEvent('a,b,c'), factory);

    expect(results).toEqual(['handled:a', 'handled:b', 'handled:c']);
    expect(factory.scopes).toHaveLength(3);
    expect(factory.scopes.every((scope) => scope.disposed)).toBe(true);
  });

  it('EntryPointMiddlewareApplication_SendsThroughApplication', async () => {
    const { pipeline, container } = createPipeline();

    const application = new MiddlewareApplicationWithResult<TestEvent, TestContext, string>(
      pipeline,
      (event) => new TestContext(event.payload),
      (context) => context.response ?? '',
    );

    const entryPoint = new EntryPointMiddlewareApplicationWithResult(
      application,
      container.createServiceResolverFactory(),
    );

    expect(await entryPoint.sendAsync(new TestEvent('bar'))).toBe('handled:bar');
  });
});
