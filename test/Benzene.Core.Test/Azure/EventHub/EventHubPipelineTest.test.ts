import { describe, expect, it } from 'vitest';
import type { ReceivedEventData } from '@azure/event-hubs';
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { ICurrentTransport, IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { BenzeneResult } from '@benzenejs/results';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { InlineAzureFunctionStartUp } from '@benzenejs/azure-function-core';
import {
  EventHubApplication,
  EventHubContext,
  EventHubMessageProcessingException,
  EventHubOptions,
  handleEventHub,
  useBenzeneMessage,
  useEventHub,
} from '@benzenejs/azure-function-event-hub';

/**
 * End-to-end port of the C# Azure Event Hub pipeline tests: wire the full stack via idiomatic DI and feed
 * realistic `ReceivedEventData` through the Azure Function entry point / `EventHubApplication` /
 * `BenzeneMessageEventHubHandler` / message-handler pipeline. Event Hub is fire-and-forget (no response),
 * like Service Bus/Kafka.
 *
 * SHAPE note (faithful to the C# package): Event Hub does NOT use per-message topic/body getters. The
 * event BODY is deserialized into a `BenzeneMessageRequest` (`{ topic, headers, body }`) by
 * `BenzeneMessageEventHubHandler`, and the inner `useBenzeneMessage`/`useMessageHandlers` pipeline routes
 * on that request's own `topic` — so a realistic Event Hub event carries a serialized `BenzeneMessage`.
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

// A realistic received Event Hub event whose body is a serialized BenzeneMessageRequest — the C#
// `BenzeneMessageEventHubHandler` deserializes `EventData.EventBody.ToString()` into one. Only `body` is
// relevant to routing, so a partial cast is used (the Service Bus test casts its message the same way).
function createBenzeneMessageEvent(topic: string, payload: unknown): ReceivedEventData {
  return {
    body: JSON.stringify({ topic, headers: {}, body: JSON.stringify(payload) }),
  } as unknown as ReceivedEventData;
}

function createRawEvent(body: unknown): ReceivedEventData {
  return { body } as unknown as ReceivedEventData;
}

describe('EventHubPipeline (via AzureFunctionApp entry point)', () => {
  it('routes an Event Hub event to a decorated handler', async () => {
    handled.length = 0;

    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useEventHub(builder, (eh) =>
          useBenzeneMessage(eh, (msg) => useMessageHandlers(msg, CreateOrderHandler)),
        ),
      )
      .build();

    await handleEventHub(app, createBenzeneMessageEvent('create-order', { orderId: '42' }));

    // The handler genuinely ran with the deserialized body.
    expect(handled).toEqual(['42']);
  });

  it('processes every event in a batch', async () => {
    handled.length = 0;

    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useEventHub(builder, (eh) =>
          useBenzeneMessage(eh, (msg) => useMessageHandlers(msg, CreateOrderHandler)),
        ),
      )
      .build();

    await handleEventHub(
      app,
      createBenzeneMessageEvent('create-order', { orderId: '1' }),
      createBenzeneMessageEvent('create-order', { orderId: '2' }),
    );

    expect(handled.sort()).toEqual(['1', '2']);
  });

  it('defers an event whose body is not a Benzene message (no topic)', async () => {
    handled.length = 0;

    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useEventHub(builder, (eh) =>
          useBenzeneMessage(eh, (msg) => useMessageHandlers(msg, CreateOrderHandler)),
        ),
      )
      .build();

    // Valid JSON but no `topic` -> BenzeneMessageEventHubHandler.canHandle is false -> defers, nothing runs.
    await handleEventHub(app, createRawEvent(JSON.stringify({ foo: 'bar' })));

    expect(handled).toEqual([]);
  });
});

describe('EventHubApplication (direct)', () => {
  it('runs every event through the pipeline in its own scope, with the event-hub transport', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);

    const seenBodies: string[] = [];
    const seenTransports: string[] = [];
    const pipeline = new MiddlewarePipelineBuilder<EventHubContext>(container);
    pipeline.useFn(async (context, next, resolver) => {
      seenBodies.push(context.eventData.body as string);
      seenTransports.push(resolver.getService(ICurrentTransport).name);
      await next();
    });

    const application = new EventHubApplication(
      pipeline.build(),
      container.createServiceResolverFactory(),
    );

    await application.sendAsync([createRawEvent('one'), createRawEvent('two')]);

    expect(seenBodies.sort()).toEqual(['one', 'two']);
    expect(seenTransports).toEqual(['event-hub', 'event-hub']);
  });

  it('EventHubContext.createInstance wraps the received event data', () => {
    const event = createRawEvent('payload');
    const context = EventHubContext.createInstance(event);
    expect(context.eventData).toBe(event);
  });

  it('EventHubOptions defaults: does not catch exceptions, escalates failure results', () => {
    // Safe-by-default on the failure-result axis (the .NET 1.0 settlement contract):
    // raiseOnFailureStatus on, catchExceptions off.
    const options = new EventHubOptions();
    expect(options.catchExceptions).toBe(false);
    expect(options.raiseOnFailureStatus).toBe(true);
  });

  it('raiseOnFailureStatus (default): a returned failure result throws EventHubMessageProcessingException', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);

    const pipeline = new MiddlewarePipelineBuilder<EventHubContext>(container);
    pipeline.useFn(async (context, next) => {
      context.messageResult = { isSuccessful: false };
      await next();
    });

    const application = new EventHubApplication(
      pipeline.build(),
      container.createServiceResolverFactory(),
    );

    await expect(application.sendAsync([createRawEvent('one')])).rejects.toThrow(
      EventHubMessageProcessingException,
    );
  });

  it('raiseOnFailureStatus (default): no result recorded does NOT throw (carve-out)', async () => {
    // CARVE-OUT — unlike the queue-shaped transports, a null outcome here (typically an unrouted
    // event) is NOT escalated: Event Hubs has no per-record dead-letter path, so retaining it would
    // replay the whole batch forever. See benzene-dotnet's work/settlement-consistency-fix-plan.md
    // row 17 — this test pins the carve-out so it can't be "fixed" by accident.
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);

    const pipeline = new MiddlewarePipelineBuilder<EventHubContext>(container);
    pipeline.useFn(async (_context, next) => {
      await next();
    });

    const application = new EventHubApplication(
      pipeline.build(),
      container.createServiceResolverFactory(),
    );

    // Reaching the end without throwing proves the null outcome settled as if it had succeeded.
    await application.sendAsync([createRawEvent('one')]);
  });

  it('raiseOnFailureStatus off: a failure result is accepted (at-most-once opt-out)', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);

    const pipeline = new MiddlewarePipelineBuilder<EventHubContext>(container);
    pipeline.useFn(async (context, next) => {
      context.messageResult = { isSuccessful: false };
      await next();
    });

    const options = new EventHubOptions();
    options.raiseOnFailureStatus = false;
    const application = new EventHubApplication(
      pipeline.build(),
      container.createServiceResolverFactory(),
      options,
    );

    await application.sendAsync([createRawEvent('one')]);
  });

  it('catchExceptions: a handler exception (and an escalated failure) is swallowed and logged', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);

    const pipeline = new MiddlewarePipelineBuilder<EventHubContext>(container);
    pipeline.useFn(() => {
      throw new Error('boom');
    });

    const options = new EventHubOptions();
    options.catchExceptions = true;
    const application = new EventHubApplication(
      pipeline.build(),
      container.createServiceResolverFactory(),
      options,
    );

    // Reaching the end without throwing proves the exception was caught, not cascaded.
    await application.sendAsync([createRawEvent('one')]);
  });

  it('envelope path: an unroutable Benzene message escalates via the surfaced inner result', async () => {
    // BenzeneMessageEventHubHandler surfaces the inner (response-suppressed) envelope pipeline's
    // result onto EventHubContext.messageResult — an unroutable topic records an explicit failure,
    // which raiseOnFailureStatus (default true) escalates. A NON-envelope body still defers with a
    // null outcome and is acked (the carve-out above).
    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useEventHub(builder, (eh) =>
          useBenzeneMessage(eh, (msg) => useMessageHandlers(msg, CreateOrderHandler)),
        ),
      )
      .build();

    await expect(
      handleEventHub(app, createBenzeneMessageEvent('no-such-topic', { orderId: '9' })),
    ).rejects.toThrow(EventHubMessageProcessingException);
  });
});
