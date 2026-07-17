import { describe, expect, it } from 'vitest';
import { ILoggerFactory, LogContextBuilderExtensions, LogLevel } from '@benzene/abstractions';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import {
  DefaultBenzeneServiceContainer,
  DefaultServiceResolverFactory,
  ServiceCollection,
} from '@benzene/dependencies';
import { FakeLoggerFactory } from '../../../Logging/Helpers/FakeLoggerFactory';

/** Port of the UseLogResult / UseLogContext scenarios from Benzene.Core.Test. */
class TestContext {
  topic = 'test-topic';
  status: string | undefined;
}

describe('LoggerExtensionsTest', () => {
  it('UseLogResult_LogsBenzeneResult_WithScopes', async () => {
    const fakeLoggerFactory = new FakeLoggerFactory();
    const services = new ServiceCollection();
    const container = new DefaultBenzeneServiceContainer(services);
    container.addSingletonInstance(ILoggerFactory, fakeLoggerFactory);

    const builder = new MiddlewarePipelineBuilder<TestContext>(container);
    builder
      .useLogResult((log) => {
        log.onRequest((_, context) => ({ topic: context.topic }));
        log.onResponse((_, context) => ({ status: context.status ?? '' }));
      })
      .onRequest((context) => {
        context.status = 'Ok';
      });

    const factory = new DefaultServiceResolverFactory(services);
    const resolver = factory.createScope();

    await builder.build().handleAsync(new TestContext(), resolver);

    resolver.dispose();
    factory.dispose();

    const entries = fakeLoggerFactory.collector.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('BenzeneResult');
    expect(entries[0].level).toBe(LogLevel.Information);
    expect(entries[0].category).toBe('Benzene');

    const scopes = entries[0].scopes;
    expect(scopes[0]).toEqual({ topic: 'test-topic' });
    expect(scopes[1]).toEqual({ status: 'Ok' });
    expect(scopes[2]).toHaveProperty('processTime');
  });

  it('UseLogContext_WrapsPipelineInRequestScope', async () => {
    const fakeLoggerFactory = new FakeLoggerFactory();
    const services = new ServiceCollection();
    const container = new DefaultBenzeneServiceContainer(services);
    container.addSingletonInstance(ILoggerFactory, fakeLoggerFactory);

    const builder = new MiddlewarePipelineBuilder<TestContext>(container);
    builder
      .useLogContext((log) => {
        LogContextBuilderExtensions.onRequest(log, 'app', 'benzene');
      })
      .useFn(async (_context, _next, resolver) => {
        resolver.getService(ILoggerFactory).createLogger('Benzene').logInformation('inside');
      });

    const factory = new DefaultServiceResolverFactory(services);
    const resolver = factory.createScope();

    await builder.build().handleAsync(new TestContext(), resolver);

    resolver.dispose();
    factory.dispose();

    const entries = fakeLoggerFactory.collector.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('inside');
    expect(entries[0].scopes).toEqual([{ app: 'benzene' }]);
  });
});
