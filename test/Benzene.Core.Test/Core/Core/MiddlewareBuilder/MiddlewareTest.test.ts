import { describe, expect, it } from 'vitest';
import { ILoggerFactory, LogLevel } from '@benzene/abstractions';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer, DefaultServiceResolverFactory, ServiceCollection } from '@benzene/dependencies';
import { FakeLoggerFactory } from '../../../Logging/Helpers/FakeLoggerFactory';

/** Port of Benzene.Test.Core.Core.MiddlewareBuilder.MiddlewareTest. */
describe('MiddlewareTest', () => {
  it('ExceptionHandler_CaughtException', async () => {
    const services = new ServiceCollection();
    const container = new DefaultBenzeneServiceContainer(services);
    const builder = new MiddlewarePipelineBuilder<object>(container);

    let caught = false;
    builder.useExceptionHandler(() => {
      caught = true;
    });
    builder.useFn(() => {
      throw new Error('Test');
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

    expect(caught).toBe(true);
  });

  it('ExceptionHandler_CaughtException_IsLogged', async () => {
    const fakeLoggerFactory = new FakeLoggerFactory();
    const services = new ServiceCollection();
    const container = new DefaultBenzeneServiceContainer(services);
    container.addSingletonInstance(ILoggerFactory, fakeLoggerFactory);
    const builder = new MiddlewarePipelineBuilder<object>(container);

    builder.useExceptionHandler(() => {});
    builder.useFn(() => {
      throw new Error('Test');
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

    const errors = fakeLoggerFactory.collector.entries.filter((x) => x.level === LogLevel.Error);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('Unhandled exception caught in middleware pipeline');
    expect((errors[0].error as Error).message).toBe('Test');
  });

  it('ExceptionHandler_ExceptionRethrownByHandler_IsStillLogged', async () => {
    const fakeLoggerFactory = new FakeLoggerFactory();
    const services = new ServiceCollection();
    const container = new DefaultBenzeneServiceContainer(services);
    container.addSingletonInstance(ILoggerFactory, fakeLoggerFactory);
    const builder = new MiddlewarePipelineBuilder<object>(container);

    builder.useExceptionHandler((_, error) => {
      throw error;
    });
    builder.useFn(() => {
      throw new Error('Test');
    });

    const pipeline = builder.build();

    const factory = new DefaultServiceResolverFactory(services);
    const resolver = factory.createScope();
    try {
      await expect(pipeline.handleAsync({}, resolver)).rejects.toThrow('Test');
    } finally {
      resolver.dispose();
      factory.dispose();
    }

    expect(
      fakeLoggerFactory.collector.entries.filter((x) => x.level === LogLevel.Error),
    ).toHaveLength(1);
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
