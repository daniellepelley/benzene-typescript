import { describe, expect, it } from 'vitest';
import type { ServiceBusReceivedMessage } from '@azure/service-bus';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { BenzeneResult } from '@benzene/results';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { InlineAzureFunctionStartUp } from '@benzene/azure-function-core';
import {
  addServiceBus,
  handleServiceBusMessages,
  ServiceBusBatchApplication,
  ServiceBusContext,
  ServiceBusMessageProcessingException,
  ServiceBusOptions,
  useServiceBus,
} from '@benzene/azure-function-service-bus';

/**
 * End-to-end port of the C# Azure Service Bus pipeline tests: wire the full stack via idiomatic DI and
 * feed realistic Service Bus messages through the Azure Function entry point / Service Bus batch
 * application / message-handler pipeline. Service Bus is fire-and-forget (no response), like SQS.
 */

class Order {
  orderId: string | undefined;
}

class OrderCreated {
  reference: string | undefined;
}

// Records which orders reached the handler, proving the message genuinely routed to it.
const handled: string[] = [];

const registry = new MessageHandlersRegistry();

@message('create-order', { registry, requestType: Order, responseType: OrderCreated })
class CreateOrderHandler implements IMessageHandler<Order, OrderCreated> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderCreated>> {
    handled.push(request.orderId ?? '<none>');
    const payload = new OrderCreated();
    payload.reference = `ref-${request.orderId}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

// A realistic ServiceBusReceivedMessage carries the topic in an application property and the payload in
// its body; the remaining system properties are irrelevant to routing, so a partial cast is used (the
// SQS test casts the Lambda Context the same way).
function createMessage(
  messageId: string,
  topic: string | undefined,
  body: unknown,
): ServiceBusReceivedMessage {
  return {
    messageId,
    body: JSON.stringify(body),
    applicationProperties: topic === undefined ? {} : { topic },
  } as unknown as ServiceBusReceivedMessage;
}

describe('ServiceBusPipeline (via AzureFunctionApp entry point)', () => {
  it('routes a Service Bus message to a decorated handler', async () => {
    handled.length = 0;

    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useServiceBus(builder, (sb) => useMessageHandlers(sb, CreateOrderHandler)),
      )
      .build();

    await handleServiceBusMessages(app, createMessage('m1', 'create-order', { orderId: '42' }));

    // The handler genuinely ran with the deserialized body.
    expect(handled).toEqual(['42']);
  });

  it('processes every message in a batch', async () => {
    handled.length = 0;

    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useServiceBus(builder, (sb) => useMessageHandlers(sb, CreateOrderHandler)),
      )
      .build();

    await handleServiceBusMessages(
      app,
      createMessage('m1', 'create-order', { orderId: '1' }),
      createMessage('m2', 'create-order', { orderId: '2' }),
    );

    expect(handled.sort()).toEqual(['1', '2']);
  });
});

describe('ServiceBusBatchApplication (direct)', () => {
  it('runs every message through the pipeline in its own scope, with the service-bus transport', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addServiceBus(container);

    const seenBodies: string[] = [];
    const pipeline = new MiddlewarePipelineBuilder<ServiceBusContext>(container);
    pipeline.useFn(async (context, next) => {
      seenBodies.push(context.message.body as string);
      await next();
    });

    const application = new ServiceBusBatchApplication(pipeline.build());
    await application.handleAsync(
      [
        createMessage('a', 'create-order', { orderId: '1' }),
        createMessage('b', 'create-order', { orderId: '2' }),
      ],
      container.createServiceResolverFactory(),
    );

    expect(seenBodies.sort()).toEqual(
      [JSON.stringify({ orderId: '1' }), JSON.stringify({ orderId: '2' })].sort(),
    );
  });

  it('raiseOnFailureStatus throws ServiceBusMessageProcessingException on an unsuccessful result', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addServiceBus(container);

    const builder = new MiddlewarePipelineBuilder<ServiceBusContext>(container);
    useMessageHandlers(builder, CreateOrderHandler);

    const options = new ServiceBusOptions();
    options.raiseOnFailureStatus = true;
    const application = new ServiceBusBatchApplication(builder.build(), options);

    // Unroutable topic -> handler result is not successful -> raiseOnFailureStatus throws.
    await expect(
      application.handleAsync(
        [createMessage('fails', 'no-such-topic', { orderId: '9' })],
        container.createServiceResolverFactory(),
      ),
    ).rejects.toThrow(ServiceBusMessageProcessingException);
  });

  it('ServiceBusOptions defaults to not catching exceptions or raising on failure', () => {
    const options = new ServiceBusOptions();
    expect(options.catchExceptions).toBe(false);
    expect(options.raiseOnFailureStatus).toBe(false);
  });
});
