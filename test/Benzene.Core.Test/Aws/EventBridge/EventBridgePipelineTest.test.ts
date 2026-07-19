import { describe, expect, it } from 'vitest';
import { Context, EventBridgeEvent } from 'aws-lambda';
import { IBenzeneResultOf } from '@benzene/abstractions';
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
import { InlineAwsLambdaStartUp } from '@benzene/aws-lambda-core';
import {
  addEventBridge,
  EventBridgeApplication,
  EventBridgeContext,
  useEventBridge,
} from '@benzene/aws-lambda-eventbridge';

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

function createEventBridgeEvent(
  detailType: string,
  detail: unknown,
): EventBridgeEvent<string, unknown> {
  return {
    id: 'evt-1',
    version: '0',
    account: '123456789012',
    time: '1970-01-01T00:00:00Z',
    region: 'us-east-1',
    resources: [],
    source: 'my.app',
    'detail-type': detailType,
    detail,
  };
}

const fakeLambdaContext = {} as Context;

describe('EventBridgePipeline (via AwsLambdaEntryPoint)', () => {
  it('routes a single EventBridge event to a decorated handler by detail-type (fire-and-forget)', async () => {
    handled.length = 0;

    const entryPoint = new InlineAwsLambdaStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((app) =>
        useEventBridge(app, (eb) => useMessageHandlers(eb, OrderCreatedHandler)),
      )
      .build();

    const event = createEventBridgeEvent('order.created', { reference: 'ABC-1' });

    const response = await entryPoint.functionHandlerAsync(event, fakeLambdaContext);

    // The handler genuinely ran with `detail` deserialized into its request...
    expect(handled).toEqual(['ABC-1']);
    // ...and EventBridge is fire-and-forget: the router marks the event handled with the null sentinel.
    expect(response).toBeNull();
  });

  it('throws BenzeneException when no router recognizes the event (no detail-type/source)', async () => {
    const entryPoint = new InlineAwsLambdaStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((app) =>
        useEventBridge(app, (eb) => useMessageHandlers(eb, OrderCreatedHandler)),
      )
      .build();

    await expect(entryPoint.functionHandlerAsync({ foo: 'bar' }, fakeLambdaContext)).rejects.toThrow(
      BenzeneException,
    );
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
    const event = createEventBridgeEvent('order.created', { reference: 'XYZ-9' });

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
    const event = createEventBridgeEvent('no.such.detail-type', { reference: '1' });

    await application.handleAsync(event, container.createServiceResolverFactory());

    expect(handled).toEqual([]);
    expect(messageResult?.isSuccessful).toBe(false);
  });
});
