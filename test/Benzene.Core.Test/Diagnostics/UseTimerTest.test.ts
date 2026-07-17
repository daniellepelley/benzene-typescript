import { describe, expect, it } from 'vitest';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer, DefaultServiceResolverFactory, ServiceCollection } from '@benzene/dependencies';
import { useTimer } from '@benzene/diagnostics';

/** Port of Benzene.Test.Core.Diagnostics.UseTimerTest. */
describe('UseTimerTest', () => {
  it('Timer_ExecutionTime', async () => {
    const services = new ServiceCollection();
    const container = new DefaultBenzeneServiceContainer(services);
    const builder = new MiddlewarePipelineBuilder<object>(container);

    let time = -1;
    useTimer<object>(builder, (_, t) => {
      time = t;
    });
    builder.useFn(async (_, next) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await next();
    });

    const pipeline = builder.build();

    const factory = new DefaultServiceResolverFactory(services);
    const resolver = factory.createScope();
    try {
      await pipeline.handleAsync({}, resolver);
    } finally {
      resolver.dispose();
      factory.dispose();
    }

    expect(time).toBeGreaterThanOrEqual(0);
  });

  it('Builder_Clear', () => {
    const services = new ServiceCollection();
    const container = new DefaultBenzeneServiceContainer(services);
    const builder = new MiddlewarePipelineBuilder<object>(container);

    builder.useFn(() => Promise.resolve());
    expect(builder.getItems()).toHaveLength(1);

    builder.clear();
    expect(builder.getItems()).toHaveLength(0);
  });
});
