import { describe, expect, it } from 'vitest';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { InlineContextConverter, MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import {
  DefaultBenzeneServiceContainer,
  DefaultServiceResolverFactory,
  ServiceCollection,
} from '@benzene/dependencies';

/**
 * Port of the pipeline-composition scenarios in
 * Benzene.Test.Core.Core.MiddlewareBuilder.ExtensionsTest (Split / Convert /
 * middleware ordering / container-resolved middleware).
 */
class TestContext {
  trace: string[] = [];
  isSpecial = false;
  result: string | undefined;
}

class InnerContext {
  value = '';
  result: string | undefined;
}

function createHarness() {
  const services = new ServiceCollection();
  const container = new DefaultBenzeneServiceContainer(services);
  const builder = new MiddlewarePipelineBuilder<TestContext>(container);
  return { services, container, builder };
}

async function run(services: ServiceCollection, action: (resolver: import('@benzene/abstractions').IServiceResolver) => Promise<void>) {
  const factory = new DefaultServiceResolverFactory(services);
  const resolver = factory.createScope();
  try {
    await action(resolver);
  } finally {
    resolver.dispose();
    factory.dispose();
  }
}

describe('ExtensionsTest', () => {
  it('Middleware_ExecutesInRegistrationOrder', async () => {
    const { services, builder } = createHarness();

    builder
      .useFn('First', async (context, next) => {
        context.trace.push('first:before');
        await next();
        context.trace.push('first:after');
      })
      .useFn('Second', async (context, next) => {
        context.trace.push('second:before');
        await next();
        context.trace.push('second:after');
      })
      .onRequest((context) => context.trace.push('onRequest'))
      .onResponse((context) => context.trace.push('onResponse'));

    const context = new TestContext();
    await run(services, (resolver) => builder.build().handleAsync(context, resolver));

    expect(context.trace).toEqual([
      'first:before',
      'second:before',
      'onRequest',
      'onResponse',
      'second:after',
      'first:after',
    ]);
  });

  it('Middleware_ShortCircuits_WhenNextNotCalled', async () => {
    const { services, builder } = createHarness();

    builder
      .useFn(async (context) => {
        context.trace.push('short-circuit');
      })
      .useFn(async (context, next) => {
        context.trace.push('unreachable');
        await next();
      });

    const context = new TestContext();
    await run(services, (resolver) => builder.build().handleAsync(context, resolver));

    expect(context.trace).toEqual(['short-circuit']);
  });

  it('Split_TakesBranch_WhenCheckPasses', async () => {
    const { services, builder } = createHarness();

    builder
      .split(
        (context) => context.isSpecial,
        (branch) => branch.onRequest((context) => context.trace.push('branch')),
      )
      .onRequest((context) => context.trace.push('main'));

    const special = new TestContext();
    special.isSpecial = true;
    const normal = new TestContext();

    await run(services, async (resolver) => {
      const pipeline = builder.build();
      await pipeline.handleAsync(special, resolver);
      await pipeline.handleAsync(normal, resolver);
    });

    expect(special.trace).toEqual(['branch']);
    expect(normal.trace).toEqual(['main']);
  });

  it('Split_WithContextPredicate', async () => {
    const { services, builder } = createHarness();

    builder
      .split(
        { check: (context) => context.isSpecial },
        (branch) => branch.onRequest((context) => context.trace.push('branch')),
      )
      .onRequest((context) => context.trace.push('main'));

    const special = new TestContext();
    special.isSpecial = true;

    await run(services, (resolver) => builder.build().handleAsync(special, resolver));

    expect(special.trace).toEqual(['branch']);
  });

  it('Convert_WithInlineFunctions_MapsResponseBack', async () => {
    const { services, builder } = createHarness();

    builder.convert<InnerContext>(
      (context) => {
        const inner = new InnerContext();
        inner.value = context.isSpecial ? 'special' : 'normal';
        return inner;
      },
      (context, inner) => {
        context.result = inner.result;
      },
      (innerBuilder) =>
        innerBuilder.onRequest((inner) => {
          inner.result = `handled:${inner.value}`;
        }),
    );

    const context = new TestContext();
    await run(services, (resolver) => builder.build().handleAsync(context, resolver));

    expect(context.result).toBe('handled:normal');
  });

  it('Convert_WithConverterAndPrebuiltPipeline', async () => {
    const { services, builder } = createHarness();

    const converter = new InlineContextConverter<TestContext, InnerContext>(
      () => new InnerContext(),
      (context, inner) => {
        context.result = inner.result;
      },
    );

    const innerBuilder = builder.create<InnerContext>();
    innerBuilder.onRequest((inner) => {
      inner.result = 'inner';
    });

    builder.convert(converter, innerBuilder.build());

    const context = new TestContext();
    await run(services, (resolver) => builder.build().handleAsync(context, resolver));

    expect(context.result).toBe('inner');
  });

  it('UseService_ResolvesMiddlewareFromContainer', async () => {
    const { services, container, builder } = createHarness();

    class TraceMiddleware implements IMiddleware<TestContext> {
      readonly name = 'Trace';

      async handleAsync(context: TestContext, next: NextFunc): Promise<void> {
        context.trace.push('from-container');
        await next();
      }
    }

    container.addSingleton(TraceMiddleware);
    builder.useService(TraceMiddleware);

    const context = new TestContext();
    await run(services, (resolver) => builder.build().handleAsync(context, resolver));

    expect(context.trace).toEqual(['from-container']);
  });
});
