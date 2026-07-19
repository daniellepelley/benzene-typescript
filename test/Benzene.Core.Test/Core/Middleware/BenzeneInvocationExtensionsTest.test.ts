import { describe, expect, it } from 'vitest';
import { ServiceIdentifier } from '@benzene/abstractions';
import { IBenzeneInvocation } from '@benzene/abstractions-middleware';
import {
  addBenzeneInvocation,
  BenzeneInvocation,
  MiddlewarePipelineBuilder,
  useBenzeneInvocation,
} from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';

/**
 * Port of the UseBenzeneInvocation / AddBenzeneInvocation scenarios: the middleware populates the
 * accessor so a downstream handler resolving `IBenzeneInvocation` sees it; resolving it before the
 * middleware ran throws (the C# `AddBenzeneInvocation` factory behaviour).
 */

class TestContext {
  invocationId: string;
  constructor(invocationId: string) {
    this.invocationId = invocationId;
  }
}

describe('BenzeneInvocationExtensionsTest', () => {
  it('useBenzeneInvocation populates the accessor so a downstream handler resolves IBenzeneInvocation', async () => {
    const container = new DefaultBenzeneServiceContainer();
    const builder = new MiddlewarePipelineBuilder<TestContext>(container);

    let seen: IBenzeneInvocation | undefined;

    useBenzeneInvocation(
      builder,
      (_resolver, context) =>
        new BenzeneInvocation(
          context.invocationId,
          'Test',
          new Map<ServiceIdentifier<unknown>, unknown>(),
        ),
    ).useFn(async (_context, next, resolver) => {
      seen = resolver.getService(IBenzeneInvocation);
      await next();
    });

    const factory = container.createServiceResolverFactory();
    const resolver = factory.createScope();
    await builder.build().handleAsync(new TestContext('req-abc'), resolver);
    resolver.dispose();
    factory.dispose();

    expect(seen).toBeDefined();
    expect(seen!.invocationId).toBe('req-abc');
    expect(seen!.platform).toBe('Test');
  });

  it('resolving IBenzeneInvocation before the middleware ran throws', () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzeneInvocation(container);

    const factory = container.createServiceResolverFactory();
    const resolver = factory.createScope();

    expect(() => resolver.getService(IBenzeneInvocation)).toThrow(
      /IBenzeneInvocation was requested before/,
    );

    resolver.dispose();
    factory.dispose();
  });
});
