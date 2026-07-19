import { describe, expect, it } from 'vitest';
import { serviceToken } from '@benzene/abstractions';
import { BenzeneApplicationBuilder, MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';

/**
 * Port of the BenzeneApplicationBuilder scenarios: it exposes the platform name, `register` lands in the
 * backing container, and `create` produces a pipeline builder sharing that container.
 */

interface IThing {
  name: string;
}
const IThing = serviceToken<IThing>('IThing');

describe('BenzeneApplicationBuilderTest', () => {
  it('exposes the platform name', () => {
    const container = new DefaultBenzeneServiceContainer();
    const builder = new BenzeneApplicationBuilder('Worker', container);

    expect(builder.platform).toBe('Worker');
  });

  it('register applies the action to the backing container', () => {
    const container = new DefaultBenzeneServiceContainer();
    const builder = new BenzeneApplicationBuilder('Worker', container);

    builder.register((c) => c.addSingletonInstance(IThing, { name: 'registered' }));

    const resolver = container.createServiceResolverFactory().createScope();
    expect(resolver.getService(IThing).name).toBe('registered');
    resolver.dispose();
  });

  it('create returns a pipeline builder', () => {
    const container = new DefaultBenzeneServiceContainer();
    const builder = new BenzeneApplicationBuilder('Worker', container);

    expect(builder.create<{ topic: string }>()).toBeInstanceOf(MiddlewarePipelineBuilder);
  });
});
