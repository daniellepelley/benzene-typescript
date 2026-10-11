import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { IMessageHandler, IMessageResult } from '@benzenejs/abstractions-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { BenzeneResult } from '@benzenejs/results';
import { BenzeneException } from '@benzenejs/core';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import {
  addEventBridge,
  EventBridgeApplication,
  EventBridgeContext,
  EventBridgeMessageBodyGetter,
  EventBridgeMessageHeadersGetter,
  EventBridgeMessageProcessingException,
  EventBridgeOptions,
  useEventBridge,
} from '@benzenejs/aws-lambda-eventbridge';
import { useAwsLambda } from '@benzenejs/aws-lambda-core';
import { benzeneTestHost, messageBuilder, type BenzeneStartUp } from '@benzenejs/testing';
import { asEventBridge } from '@benzenejs/aws-lambda-testing';

/**
 * End-to-end port of the C# EventBridge pipeline test
 * (test/Benzene.Core.Test/Aws/EventBridge/EventBridgeMessagePipelineTest.cs): wire the full stack via
 * idiomatic DI and feed a realistic SINGLE EventBridge event through the Lambda entry point / EventBridge
 * router / message-handler pipeline. The topic is `detail-type` (EventBridge's native routing key) and the
 * body is `detail`. EventBridge delivers ONE event per invocation (not a `Records` batch) and is
 * fire-and-forget, so the router writes the `null` "handled" sentinel.
 */

class Order {
  reference: string | undefined;
}

class OrderCreated {
  confirmation: string | undefined;
}

const handled: string[] = [];
const registry = new MessageHandlersRegistry();

@message('order.created', { registry, requestType: Order, responseType: OrderCreated })
class OrderCreatedHandler implements IMessageHandler<Order, OrderCreated> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderCreated>> {
    handled.push(request.reference ?? '<none>');
    const payload = new OrderCreated();
    payload.confirmation = `confirmed-${request.reference}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

// Migrated off `InlineAwsLambdaStartUp` to the public startup-host harness
// (`benzeneTestHost(StartUp).buildAwsLambdaHost()` + `host.sendEventAsync(...)`) with the `asEventBridge`
// event builder — the exact shape an adopter copies.
class EventBridgeStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
  }

  configure(app: IBenzeneApplicationBuilder): void {
    useAwsLambda(app, (aws) => useEventBridge(aws, (eb) => useMessageHandlers(eb, OrderCreatedHandler)));
  }
}

describe('EventBridgePipeline (via the benzeneTestHost harness)', () => {
  it('routes a single EventBridge event to a decorated handler by detail-type (fire-and-forget)', async () => {
    handled.length = 0;

    const host = benzeneTestHost(EventBridgeStartUp).buildAwsLambdaHost();

    const response = await host.sendEventAsync(
      asEventBridge(messageBuilder('order.created', { reference: 'ABC-1' })),
    );

    // The handler genuinely ran with `detail` deserialized into its request...
    expect(handled).toEqual(['ABC-1']);
    // ...and EventBridge is fire-and-forget: the router marks the event handled with the null sentinel.
    expect(response).toBeNull();
  });

  it('throws BenzeneException when no router recognizes the event (no detail-type/source)', async () => {
    const host = benzeneTestHost(EventBridgeStartUp).buildAwsLambdaHost();

    await expect(host.sendEventAsync({ foo: 'bar' })).rejects.toThrow(BenzeneException);
  });
});

describe('EventBridgeApplication (direct)', () => {
  it('runs the single event through the pipeline, recording a successful message result', async () => {
    handled.length = 0;

    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addEventBridge(container);

    let messageResult: IMessageResult | undefined;
    const pipeline = new MiddlewarePipelineBuilder<EventBridgeContext>(container);
    pipeline.onResponse((context) => {
      messageResult = context.messageResult;
    });
    useMessageHandlers(pipeline, OrderCreatedHandler);

    const application = new EventBridgeApplication(pipeline.build());
    const event = asEventBridge(messageBuilder('order.created', { reference: 'XYZ-9' }));

    await application.handleAsync(event, container.createServiceResolverFactory());

    expect(handled).toEqual(['XYZ-9']);
    expect(messageResult?.isSuccessful).toBe(true);
  });

  it('fails the invocation for an unknown detail-type, recording the unsuccessful result', async () => {
    handled.length = 0;

    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addEventBridge(container);

    let messageResult: IMessageResult | undefined;
    const pipeline = new MiddlewarePipelineBuilder<EventBridgeContext>(container);
    pipeline.onResponse((context) => {
      messageResult = context.messageResult;
    });
    useMessageHandlers(pipeline, OrderCreatedHandler);

    const application = new EventBridgeApplication(pipeline.build());
    const event = asEventBridge(messageBuilder('no.such.detail-type', { reference: '1' }));

    // One-shot settlement (transport-bindings §1, obligation 8): an unmatched topic is a not-found failure,
    // so the invocation fails and EventBridge retries the event.
    await expect(application.handleAsync(event, container.createServiceResolverFactory())).rejects.toThrow(
      EventBridgeMessageProcessingException,
    );

    expect(handled).toEqual([]);
    expect(messageResult?.isSuccessful).toBe(false);
  });

  it('acknowledges an unknown detail-type under ignoreUnmatchedTopics, and a failure under atMostOnce', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addEventBridge(container);
    const pipeline = new MiddlewarePipelineBuilder<EventBridgeContext>(container);
    useMessageHandlers(pipeline, OrderCreatedHandler);
    const built = pipeline.build();
    const event = asEventBridge(messageBuilder('no.such.detail-type', { reference: '1' }));

    const ignoring = new EventBridgeOptions();
    ignoring.ignoreUnmatchedTopics = true;
    await expect(
      new EventBridgeApplication(built, ignoring).handleAsync(event, container.createServiceResolverFactory()),
    ).resolves.toBeUndefined();

    const atMostOnce = new EventBridgeOptions();
    atMostOnce.atMostOnce = true;
    await expect(
      new EventBridgeApplication(built, atMostOnce).handleAsync(event, container.createServiceResolverFactory()),
    ).resolves.toBeUndefined();
  });
});

describe('EventBridge benzene-headers (wire-contracts §2, D14)', () => {
  it('reads the embedded benzene-headers into the header dictionary and leaves detail unchanged', () => {
    const event = {
      id: 'evt-1',
      source: 'orders',
      'detail-type': 'order.created',
      detail: { reference: 'R-1', 'benzene-headers': { traceparent: 'tp-1', 'x-correlation-id': 'c-1' } },
    } as unknown as ConstructorParameters<typeof EventBridgeContext>[0];
    const context = new EventBridgeContext(event);

    const headers = new EventBridgeMessageHeadersGetter().getHeaders(context);
    expect(EventBridgeMessageHeadersGetter.EmbeddedHeadersKey).toBe('benzene-headers');
    expect(headers.traceparent).toBe('tp-1');
    expect(headers['x-correlation-id']).toBe('c-1');

    // The body is `detail` unchanged — the embedded member is NOT stripped.
    const body = JSON.parse(new EventBridgeMessageBodyGetter().getBody(context)!) as Record<string, unknown>;
    expect(body['benzene-headers']).toEqual({ traceparent: 'tp-1', 'x-correlation-id': 'c-1' });
    expect(body.reference).toBe('R-1');
  });

  it('does not read the retired _benzeneHeaders key (clean break, no dual-accept)', () => {
    const event = {
      source: 'orders',
      'detail-type': 'order.created',
      detail: { _benzeneHeaders: { traceparent: 'tp-old' } },
    } as unknown as ConstructorParameters<typeof EventBridgeContext>[0];

    expect(new EventBridgeMessageHeadersGetter().getHeaders(new EventBridgeContext(event)).traceparent).toBeUndefined();
  });
});
