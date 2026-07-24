import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDisposable, ILogger, ILoggerFactory, LoggerBase, LogLevel } from '@benzene/abstractions';
import { IBenzeneInvocation } from '@benzene/abstractions-middleware';
import { addDiagnostics, useBenzeneEnrichment } from '@benzene/diagnostics';
import { addBenzeneMiddleware, BenzeneInvocation, MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { OtelHarness } from './otelHarness';

/**
 * Port of test/Benzene.Core.Test/Diagnostics/BenzeneEnrichmentTest.cs. A capturing logger factory stands
 * in for the C# `FakeLoggerFactory`, and the in-memory OpenTelemetry span exporter provides the active
 * span whose trace/span ids are enriched onto the log scope.
 */

const harness = new OtelHarness();
beforeEach(() => harness.start());
afterEach(() => harness.stop());

class CapturingLogger extends LoggerBase {
  constructor(private readonly sink: Record<string, unknown>[]) {
    super();
  }
  log(_level: LogLevel, _message: string): void {}
  beginScope(state: Readonly<Record<string, unknown>>): IDisposable {
    this.sink.push({ ...state });
    return { dispose: () => {} };
  }
}

class CapturingLoggerFactory implements ILoggerFactory {
  readonly scopes: Record<string, unknown>[] = [];
  createLogger(): ILogger {
    return new CapturingLogger(this.scopes);
  }
}

describe('useBenzeneEnrichment', () => {
  it('adds invocationId, traceId, and spanId to the log scope', async () => {
    const loggerFactory = new CapturingLoggerFactory();
    const container = new DefaultBenzeneServiceContainer();
    addBenzeneMiddleware(container);
    addDiagnostics(container); // provides the active span whose ids are enriched
    container.addSingletonInstance(ILoggerFactory, loggerFactory);
    container.addScopedInstance(
      IBenzeneInvocation,
      new BenzeneInvocation('test-invocation-id', 'Test', new Map()),
    );

    const builder = new MiddlewarePipelineBuilder<object>(container);
    useBenzeneEnrichment(builder);
    builder.useFn('handle', (_c, next) => next());

    const resolver = container.createServiceResolverFactory().createScope();
    await builder.build().handleAsync({}, resolver);

    expect(loggerFactory.scopes.some((s) => s.invocationId === 'test-invocation-id')).toBe(true);
    expect(loggerFactory.scopes.some((s) => 'traceId' in s)).toBe(true);
    expect(loggerFactory.scopes.some((s) => 'spanId' in s)).toBe(true);
  });

  it('degrades gracefully without an invocation registered', async () => {
    const loggerFactory = new CapturingLoggerFactory();
    const container = new DefaultBenzeneServiceContainer();
    addBenzeneMiddleware(container);
    container.addSingletonInstance(ILoggerFactory, loggerFactory);

    const builder = new MiddlewarePipelineBuilder<object>(container);
    useBenzeneEnrichment(builder);
    builder.useFn('handle', (_c, next) => next());

    const resolver = container.createServiceResolverFactory().createScope();
    // No IBenzeneInvocation registered - the key is simply omitted, no throw.
    await builder.build().handleAsync({}, resolver);

    expect(loggerFactory.scopes.every((s) => !('invocationId' in s))).toBe(true);
  });
});
