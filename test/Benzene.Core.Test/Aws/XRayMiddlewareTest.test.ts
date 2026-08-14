import { describe, expect, it } from 'vitest';
import { IServiceResolver, ServiceIdentifier } from '@benzenejs/abstractions';
import {
  ICurrentTransport,
  IMessageGetter,
  IMessageHandlerDefinitionLookUp,
  TransportNames,
} from '@benzenejs/abstractions-message-handlers';
import { IMiddleware, IMiddlewareWrapper } from '@benzenejs/abstractions-middleware';
import { addBenzeneMiddleware, MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { Topic } from '@benzenejs/core-messages';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { fakeResolver } from '@benzenejs/testing';
import {
  addXRayTracing,
  IXRayRecorder,
  XRayMiddlewareDecorator,
  XRayMiddlewareWrapper,
} from '@benzenejs/aws-lambda-xray';

/**
 * Port of the C# Benzene.Aws.Tests.XRayMiddlewareTest, adapted to the injectable `IXRayRecorder` seam
 * (the .NET tests use the real `AWSXRayRecorder.Instance` + a forced segment; the port drives a fake
 * recorder that records begin/annotate/exception/end, plus the real recorder's off-Lambda no-op path).
 */

/** A fake recorder maintaining a subsegment stack, so nesting order is observable. */
class FakeRecorder implements IXRayRecorder {
  readonly events: string[] = [];
  active = true;
  private readonly stack: string[] = [];

  beginSubsegment(name: string): boolean {
    if (!this.active) {
      return false;
    }
    this.stack.push(name);
    this.events.push(`begin:${name}`);
    return true;
  }
  addAnnotation(key: string, value: string): void {
    this.events.push(`annotate:${key}=${value}`);
  }
  addException(_error: unknown): void {
    this.events.push(`exception:${this.stack[this.stack.length - 1]}`);
  }
  endSubsegment(): void {
    this.events.push(`end:${this.stack.pop()}`);
  }
}

const emptyResolver: IServiceResolver = fakeResolver([]);
const middleware = (name: string, run?: (next: () => Promise<void>) => Promise<void>): IMiddleware<object> => ({
  name,
  handleAsync: (_context, next) => (run ? run(next) : next()),
});

describe('XRayMiddlewareDecorator', () => {
  it('opens a subsegment named after each middleware, nested in pipeline order', async () => {
    const recorder = new FakeRecorder();
    const second = new XRayMiddlewareDecorator(middleware('second'), emptyResolver, recorder);
    const first = new XRayMiddlewareDecorator(
      middleware('first', (next) => second.handleAsync({}, next)),
      emptyResolver,
      recorder,
    );

    await first.handleAsync({}, () => Promise.resolve());

    expect(recorder.events).toEqual(['begin:first', 'begin:second', 'end:second', 'end:first']);
  });

  it('records the exception on a throwing middleware and rethrows', async () => {
    const recorder = new FakeRecorder();
    const decorator = new XRayMiddlewareDecorator(
      middleware('boom', () => Promise.reject(new Error('kaboom'))),
      emptyResolver,
      recorder,
    );

    await expect(decorator.handleAsync({}, () => Promise.resolve())).rejects.toThrow('kaboom');
    expect(recorder.events).toEqual(['begin:boom', 'exception:boom', 'end:boom']);
  });

  it('is a no-op when there is no active segment (beginSubsegment returns false)', async () => {
    const recorder = new FakeRecorder();
    recorder.active = false;
    let ran = false;
    const decorator = new XRayMiddlewareDecorator(
      middleware('solo', (next) => {
        ran = true;
        return next();
      }),
      emptyResolver,
      recorder,
    );

    await decorator.handleAsync({}, () => Promise.resolve());

    expect(ran).toBe(true);
    expect(recorder.events).toEqual([]);
  });

  it('annotates the resolved transport, topic, version, and handler', async () => {
    const recorder = new FakeRecorder();
    class CreateOrderHandler {}
    const resolver = fakeResolver([
      [ICurrentTransport as ServiceIdentifier<unknown>, { name: 'sqs' }],
      [
        IMessageGetter as ServiceIdentifier<unknown>,
        { getTopic: () => new Topic('order:placed', 'v1') },
      ],
      [
        IMessageHandlerDefinitionLookUp as ServiceIdentifier<unknown>,
        { findHandler: () => ({ handlerType: CreateOrderHandler }) },
      ],
    ]);
    const decorator = new XRayMiddlewareDecorator(middleware('router'), resolver, recorder);

    await decorator.handleAsync({}, () => Promise.resolve());

    expect(recorder.events).toContain('annotate:benzene_transport=sqs');
    expect(recorder.events).toContain('annotate:benzene_topic=order:placed');
    expect(recorder.events).toContain('annotate:benzene_version=v1');
    expect(recorder.events).toContain('annotate:benzene_handler=CreateOrderHandler');
  });

  it('skips the transport annotation while the transport is still unresolved', async () => {
    const recorder = new FakeRecorder();
    const resolver = fakeResolver([
      [ICurrentTransport as ServiceIdentifier<unknown>, { name: TransportNames.Unresolved }],
    ]);
    const decorator = new XRayMiddlewareDecorator(middleware('probe'), resolver, recorder);

    await decorator.handleAsync({}, () => Promise.resolve());

    expect(recorder.events.some((e) => e.startsWith('annotate:benzene_transport'))).toBe(false);
  });
});

describe('addXRayTracing', () => {
  it('registers the wrapper once even when called repeatedly (idempotent)', () => {
    const container = new DefaultBenzeneServiceContainer();
    addXRayTracing(container);
    addXRayTracing(container);

    const wrappers = container
      .createServiceResolverFactory()
      .createScope()
      .getServices(IMiddlewareWrapper)
      .filter((w) => w instanceof XRayMiddlewareWrapper);
    expect(wrappers).toHaveLength(1);
  });

  it('is a safe no-op with no active X-Ray segment (off Lambda): the pipeline still runs', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzeneMiddleware(container);
    addXRayTracing(container);

    let ran = false;
    const builder = new MiddlewarePipelineBuilder<object>(container);
    builder.useFn('solo', (_context, next) => {
      ran = true;
      return next();
    });
    const pipeline = builder.build();

    const scope = container.createServiceResolverFactory().createScope();
    await pipeline.handleAsync({}, scope);
    scope.dispose();

    expect(ran).toBe(true);
  });
});
