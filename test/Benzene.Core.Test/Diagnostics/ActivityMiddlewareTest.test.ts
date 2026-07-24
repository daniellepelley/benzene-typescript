import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SpanStatusCode } from '@opentelemetry/api';
import { IBenzeneResult } from '@benzene/abstractions';
import { IHasMessageResult, IMessageGetter } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import {
  ActivityProcessTimerFactory,
  addActivityPerMiddleware,
  addDiagnostics,
  IProcessTimerFactory,
  useTimer,
} from '@benzene/diagnostics';
import { addBenzeneMiddleware, MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { CurrentTransportInfo } from '@benzene/core-message-handlers';
import { ICurrentTransport } from '@benzene/abstractions-message-handlers';
import { Topic } from '@benzene/core-messages';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import { OtelHarness } from './otelHarness';

/**
 * Port of test/Benzene.Core.Test/Diagnostics/ActivityMiddlewareTest.cs. The C# `ActivityListener` is
 * replaced by an in-memory OpenTelemetry span exporter (see otelHarness.ts). `benzene.status` values are
 * the port's status strings (`NotFound`, not the .NET `not-found`), reflecting the port's existing
 * PascalCase `BenzeneResultStatus`.
 */

const harness = new OtelHarness();
beforeEach(() => harness.start());
afterEach(() => harness.stop());

class StatusContext implements IHasMessageResult {
  messageResult: IBenzeneResult = BenzeneResult.ok();
}

class FakeMessageGetter implements IMessageGetter<StatusContext> {
  getTopic(): ITopic {
    return new Topic('orders:create');
  }
  getBody(): string | undefined {
    return undefined;
  }
  getHeaders(): Record<string, string> {
    return {};
  }
}

describe('ActivityMiddleware', () => {
  it('addActivityPerMiddleware produces one named span per middleware', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzeneMiddleware(container);
    addActivityPerMiddleware(container);

    const builder = new MiddlewarePipelineBuilder<object>(container);
    builder.useFn('first', (_c, next) => next());
    builder.useFn('second', (_c, next) => next());

    const resolver = container.createServiceResolverFactory().createScope();
    await builder.build().handleAsync({}, resolver);

    expect(harness.spans().some((s) => s.name === 'first')).toBe(true);
    expect(harness.spans().some((s) => s.name === 'second')).toBe(true);
  });

  it('addActivityPerMiddleware is idempotent and composes with addDiagnostics (no double-wrap)', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzeneMiddleware(container);
    addActivityPerMiddleware(container);
    addDiagnostics(container);
    addActivityPerMiddleware(container);

    const builder = new MiddlewarePipelineBuilder<object>(container);
    builder.useFn('only', (_c, next) => next());

    const resolver = container.createServiceResolverFactory().createScope();
    await builder.build().handleAsync({}, resolver);

    // Registered once as an IMiddlewareWrapper, so the middleware is wrapped in exactly one span.
    expect(harness.spans().filter((s) => s.name === 'only')).toHaveLength(1);
  });

  it('omits the transport tag while the transport is unresolved', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzeneMiddleware(container);
    addDiagnostics(container);
    container.addScoped(CurrentTransportInfo);
    container.addScopedFactory(ICurrentTransport, (r) => r.getService(CurrentTransportInfo));

    const builder = new MiddlewarePipelineBuilder<object>(container);
    builder.useFn('probe', (_c, next) => next());

    const resolver = container.createServiceResolverFactory().createScope();
    await builder.build().handleAsync({}, resolver);

    expect(harness.span('probe').attributes['benzene.transport']).toBeUndefined();
  });

  it('tags the transport once a transport pipeline has resolved it', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzeneMiddleware(container);
    addDiagnostics(container);
    container.addScoped(CurrentTransportInfo);
    container.addScopedFactory(ICurrentTransport, (r) => r.getService(CurrentTransportInfo));

    const builder = new MiddlewarePipelineBuilder<object>(container);
    builder.useFn('resolved', (_c, next) => next());

    const resolver = container.createServiceResolverFactory().createScope();
    resolver.getService(CurrentTransportInfo).setTransport('sns');
    await builder.build().handleAsync({}, resolver);

    expect(harness.span('resolved').attributes['benzene.transport']).toBe('sns');
  });

  it('marks the span as error, with an exception event, when a middleware throws', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzeneMiddleware(container);
    addDiagnostics(container);

    const builder = new MiddlewarePipelineBuilder<object>(container);
    builder.useFn('boom', () => {
      throw new Error('kaboom');
    });

    const resolver = container.createServiceResolverFactory().createScope();
    await expect(builder.build().handleAsync({}, resolver)).rejects.toThrow('kaboom');

    expect(
      harness.spans().some((s) => s.status.code === SpanStatusCode.ERROR && s.events.some((e) => e.name === 'exception')),
    ).toBe(true);
  });

  it('tags benzene.status on the topic-bearing span from the result', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzeneMiddleware(container);
    addDiagnostics(container);
    container.addScopedInstance(IMessageGetter, new FakeMessageGetter() as IMessageGetter<unknown>);

    const builder = new MiddlewarePipelineBuilder<StatusContext>(container);
    builder.useFn('handle', (_c, next) => next());

    const context = new StatusContext();
    context.messageResult = BenzeneResult.notFound();
    const resolver = container.createServiceResolverFactory().createScope();
    await builder.build().handleAsync(context, resolver);

    const span = harness.span('handle');
    expect(span.attributes['benzene.topic']).toBe('orders:create');
    expect(span.attributes['benzene.status']).toBe(BenzeneResultStatus.notFound);
  });

  it('tags benzene.status=exception when the topic-bearing span throws', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzeneMiddleware(container);
    addDiagnostics(container);
    container.addScopedInstance(IMessageGetter, new FakeMessageGetter() as IMessageGetter<unknown>);

    const builder = new MiddlewarePipelineBuilder<StatusContext>(container);
    builder.useFn('handle', () => {
      throw new Error('kaboom');
    });

    const resolver = container.createServiceResolverFactory().createScope();
    await expect(builder.build().handleAsync(new StatusContext(), resolver)).rejects.toThrow('kaboom');

    expect(harness.span('handle').attributes['benzene.status']).toBe('exception');
  });

  it('useTimer over the activity timer factory produces a span', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzeneMiddleware(container);
    // Only the timer factory (not addDiagnostics's per-middleware wrapper), so the timer's own span is
    // the sole 'my-timer' span - otherwise the wrapper adds a second same-named span (the C# note).
    container.addScopedFactory(IProcessTimerFactory, () => new ActivityProcessTimerFactory());

    const builder = new MiddlewarePipelineBuilder<object>(container);
    useTimer(builder, 'my-timer');
    builder.useFn('handle', (_c, next) => next());

    const resolver = container.createServiceResolverFactory().createScope();
    await builder.build().handleAsync({}, resolver);

    // (The C# UseTimer also marks the timer span Error on a downstream throw by marking Activity.Current;
    // OTel JS's startSpan doesn't set the active span, so the ported useTimer doesn't replicate that - a
    // documented minor gap. The load-bearing behavior, a span per timed scope, is asserted here.)
    expect(harness.span('my-timer').name).toBe('my-timer');
  });
});
