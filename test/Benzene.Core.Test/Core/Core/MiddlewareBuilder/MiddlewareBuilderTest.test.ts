import { describe, expect, it } from 'vitest';
import { Constants } from '@benzene/core';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import {
  DefaultBenzeneServiceContainer,
  DefaultServiceResolverFactory,
  ServiceCollection,
} from '@benzene/dependencies';

/**
 * Port of Benzene.Test.Core.Core.MiddlewareBuilder.MiddlewareBuilderTest.
 * The C# tests use BenzeneMessageContext, which lives in Benzene.Core.Messages
 * (not yet ported); a minimal stand-in context with the same shape is used instead.
 */
class TestMessageResponse {
  body: string | undefined;
}

class TestMessageContext {
  response: TestMessageResponse | undefined;
}

describe('MiddlewareBuilderTest', () => {
  it('CreatePipeline_OnResponse', async () => {
    const services = new ServiceCollection();
    const container = new DefaultBenzeneServiceContainer(services);

    const middlewarePipelineBuilder = new MiddlewarePipelineBuilder<TestMessageContext>(container);

    middlewarePipelineBuilder.onResponse('Foo', (context) => {
      context.response = new TestMessageResponse();
      context.response.body = 'foo';
    });

    expect(middlewarePipelineBuilder.getItems()).toHaveLength(1);

    const factory = new DefaultServiceResolverFactory(services);
    const serviceResolver = factory.createScope();

    const context = new TestMessageContext();
    await middlewarePipelineBuilder.build().handleAsync(context, serviceResolver);

    serviceResolver.dispose();
    factory.dispose();

    expect(context.response?.body).toBe('foo');
  });

  it('CreatePipeline_MiddlewareNames', async () => {
    const services = new ServiceCollection();
    const container = new DefaultBenzeneServiceContainer(services);

    const middlewarePipelineBuilder = new MiddlewarePipelineBuilder<TestMessageContext>(container);

    middlewarePipelineBuilder
      .useFn(async (_, next) => await next())
      .useFn('', async (_, next) => await next())
      .useFn(async (_, next, _resolver) => await next())
      .useFn('', async (_, next, _resolver) => await next())
      .onRequest(() => {})
      .onRequest('', () => {})
      .onRequest((_context, _resolver) => {})
      .onRequest('', (_context, _resolver) => {})
      .onResponse(() => {})
      .onResponse('', () => {})
      .onResponse((_context, _resolver) => {})
      .onResponse('', (context, _resolver) => {
        context.response = new TestMessageResponse();
        context.response.body = 'foo';
      });

    const items = middlewarePipelineBuilder.getItems();
    expect(items).toHaveLength(12);

    const factory = new DefaultServiceResolverFactory(services);
    const serviceResolver = factory.createScope();

    for (const item of items) {
      expect(item(serviceResolver).name).toBe(Constants.unnamed);
    }

    const context = new TestMessageContext();
    await middlewarePipelineBuilder.build().handleAsync(context, serviceResolver);

    serviceResolver.dispose();
    factory.dispose();

    expect(context.response?.body).toBe('foo');
  });
});
