import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzene/abstractions';
import { IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { IMessageHandler, IMessageResult } from '@benzene/abstractions-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { BenzeneResult } from '@benzene/results';
import { BenzeneException } from '@benzene/core';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import {
  addEventBridge,
  EventBridgeApplication,
  EventBridgeContext,
  useEventBridge,
} from '@benzene/aws-lambda-eventbridge';
import { useAwsLambda } from '@benzene/aws-lambda-core';
import { benzeneTestHost, messageBuilder, type BenzeneStartUp } from '@benzene/testing';
import { asEventBridge } from '@benzene/aws-lambda-testing';

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

  it('records an unsuccessful result for an unknown detail-type', async () => {
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

    await application.handleAsync(event, container.createServiceResolverFactory());

    expect(handled).toEqual([]);
    expect(messageResult?.isSuccessful).toBe(false);
  });
});
