import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { ICurrentTransport, IMessageHandler } from '@benzene/abstractions-message-handlers';
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
  addEventGrid,
  EventGridBatchApplication,
  EventGridContext,
  EventGridMessageBodyGetter,
  EventGridMessageHeadersGetter,
  EventGridMessageProcessingException,
  EventGridOptions,
  EventGridTriggerEvent,
  handleEventGridEvent,
  useEventGrid,
} from '@benzene/azure-function-event-grid';

/**
 * End-to-end port of the C# Azure Event Grid pipeline tests (EventGridPipelineTest.cs +
 * EventGridFailureHandlingTest.cs): wire the full stack via idiomatic DI and route delivered events BY
 * EVENT TYPE (`eventType` in the Event Grid schema, `type` in CloudEvents) through the Azure Function
 * entry point / `EventGridApplication` / message-handler pipeline. Event Grid is fire-and-forget from
 * the handler's perspective — a thrown exception (or an escalated failure result) is what drives its own
 * retry/dead-letter machinery.
 */

const TOPIC = 'create-order';

class Order {
  orderId: string | undefined;
}

class OrderCreated {
  reference: string | undefined;
}

// Records which orders reached the handler, proving the event genuinely routed to it.
const handled: string[] = [];

const registry = new MessageHandlersRegistry();

@message(TOPIC, { registry, requestType: Order, responseType: OrderCreated })
class CreateOrderHandler implements IMessageHandler<Order, OrderCreated> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderCreated>> {
    handled.push(request.orderId ?? '<none>');
    const payload = new OrderCreated();
    payload.reference = `ref-${request.orderId}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

function createApp() {
  return new InlineAzureFunctionStartUp()
    .configureServices((services) => addBenzene(services))
    .configure((builder) => useEventGrid(builder, (eventGrid) => useMessageHandlers(eventGrid, CreateOrderHandler)))
    .build();
}

describe('EventGridPipeline (via AzureFunctionApp entry point)', () => {
  it('routes an Event Grid schema event by its event type and delivers data as the payload', async () => {
    handled.length = 0;
    const app = createApp();

    const eventJson = JSON.stringify({
      id: 'event-1',
      topic: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/acct',
      subject: '/blobServices/default/containers/orders',
      eventType: TOPIC,
      eventTime: '2026-07-17T10:00:00Z',
      dataVersion: '1.0',
      data: { orderId: '42' },
    });

    await handleEventGridEvent(app, eventJson);

    expect(handled).toEqual(['42']);
  });

  it('routes a CloudEvents schema event by its type and delivers data as the payload', async () => {
    handled.length = 0;
    const app = createApp();

    const eventJson = JSON.stringify({
      specversion: '1.0',
      id: 'event-2',
      source: '/mycontext',
      subject: 'orders/42',
      type: TOPIC,
      time: '2026-07-17T10:00:00Z',
      data: { orderId: '7' },
    });

    await handleEventGridEvent(app, eventJson);

    expect(handled).toEqual(['7']);
  });

  it('parse (Event Grid schema): maps the envelope fields', () => {
    const parsed = EventGridTriggerEvent.parse(
      JSON.stringify({
        id: 'event-1',
        topic: '/subscriptions/sub',
        subject: 'some-subject',
        eventType: 'Custom.Event',
        eventTime: '2026-07-17T10:00:00Z',
        dataVersion: '2.1',
        data: { name: 'value' },
      }),
    );

    expect(parsed.id).toBe('event-1');
    expect(parsed.eventType).toBe('Custom.Event');
    expect(parsed.subject).toBe('some-subject');
    expect(parsed.source).toBe('/subscriptions/sub');
    expect(parsed.dataVersion).toBe('2.1');
    expect(parsed.eventTime).toBeDefined();
    expect(parsed.data).toBeDefined();
  });

  it('parse (CloudEvents schema): maps type and source', () => {
    const parsed = EventGridTriggerEvent.parse(
      JSON.stringify({
        specversion: '1.0',
        id: 'event-2',
        source: '/mycontext',
        type: 'Custom.Event',
        time: '2026-07-17T10:00:00Z',
      }),
    );

    expect(parsed.eventType).toBe('Custom.Event');
    expect(parsed.source).toBe('/mycontext');
    expect(parsed.data).toBeUndefined();
  });

  it('surfaces the envelope fields as headers', () => {
    const headersGetter = new EventGridMessageHeadersGetter();
    const context = new EventGridContext(
      EventGridTriggerEvent.parse(
        JSON.stringify({
          id: 'event-1',
          topic: '/subscriptions/sub',
          subject: 'some-subject',
          eventType: 'Custom.Event',
        }),
      ),
    );

    const headers = headersGetter.getHeaders(context);

    expect(headers['id']).toBe('event-1');
    expect(headers['subject']).toBe('some-subject');
    expect(headers['source']).toBe('/subscriptions/sub');
  });

  it('binds an empty body when the event carries no data', () => {
    const bodyGetter = new EventGridMessageBodyGetter();
    const context = new EventGridContext(
      EventGridTriggerEvent.parse(JSON.stringify({ eventType: 'Custom.Event' })),
    );

    expect(bodyGetter.getBody(context)).toBe('{}');
  });
});

describe('EventGridBatchApplication (direct)', () => {
  function createEvent(id = 'evt-1'): EventGridTriggerEvent[] {
    return [new EventGridTriggerEvent({ id, eventType: 'OrderPlaced' })];
  }

  it('EventGridOptions defaults: does not catch exceptions, escalates failure results', () => {
    const options = new EventGridOptions();
    expect(options.catchExceptions).toBe(false);
    expect(options.raiseOnFailureStatus).toBe(true);
  });

  it('runs every event through the pipeline in its own scope, with the event-grid transport', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addEventGrid(container);

    const seenIds: (string | undefined)[] = [];
    const seenTransports: string[] = [];
    const pipeline = new MiddlewarePipelineBuilder<EventGridContext>(container);
    pipeline.useFn(async (context, next, resolver) => {
      seenIds.push(context.event.id);
      seenTransports.push(resolver.getService(ICurrentTransport).name);
      await next();
    });

    const application = new EventGridBatchApplication(pipeline.build());
    await application.handleAsync(
      [
        new EventGridTriggerEvent({ id: 'a', eventType: 'OrderPlaced' }),
        new EventGridTriggerEvent({ id: 'b', eventType: 'OrderPlaced' }),
      ],
      container.createServiceResolverFactory(),
    );

    expect(seenIds.sort()).toEqual(['a', 'b']);
    expect(seenTransports).toEqual(['event-grid', 'event-grid']);
  });

  it('default options: a handler exception cascades', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addEventGrid(container);

    const pipeline = new MiddlewarePipelineBuilder<EventGridContext>(container);
    pipeline.useFn(() => {
      throw new Error('boom');
    });

    const application = new EventGridBatchApplication(pipeline.build());

    await expect(
      application.handleAsync(createEvent(), container.createServiceResolverFactory()),
    ).rejects.toThrow('boom');
  });

  it('raiseOnFailureStatus (default true): a handler failure result throws EventGridMessageProcessingException', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addEventGrid(container);

    const pipeline = new MiddlewarePipelineBuilder<EventGridContext>(container);
    pipeline.useFn(async (context, next) => {
      context.messageResult = { isSuccessful: false };
      await next();
    });

    const application = new EventGridBatchApplication(pipeline.build());

    const error = await application
      .handleAsync(createEvent('evt-2'), container.createServiceResolverFactory())
      .then(
        () => undefined,
        (e: unknown) => e,
      );

    expect(error).toBeInstanceOf(EventGridMessageProcessingException);
    expect((error as EventGridMessageProcessingException).eventId).toBe('evt-2');
  });

  it('does not escalate a failure result when raiseOnFailureStatus is disabled', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addEventGrid(container);

    const pipeline = new MiddlewarePipelineBuilder<EventGridContext>(container);
    pipeline.useFn(async (context, next) => {
      context.messageResult = { isSuccessful: false };
      await next();
    });

    const options = new EventGridOptions();
    options.raiseOnFailureStatus = false;
    const application = new EventGridBatchApplication(pipeline.build(), options);

    // Opt-out (at-most-once): a returned failure is accepted like a success, so nothing is thrown.
    await application.handleAsync(createEvent(), container.createServiceResolverFactory());
  });
});
