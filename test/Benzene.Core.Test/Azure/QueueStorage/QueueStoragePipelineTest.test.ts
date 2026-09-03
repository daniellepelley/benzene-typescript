import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { ICurrentTransport, IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { BenzeneResult, BenzeneResultStatus } from '@benzenejs/results';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
  usePresetTopic,
} from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { InlineAzureFunctionStartUp } from '@benzenejs/azure-function-core';
import {
  addQueueStorage,
  handleQueueMessage,
  handleQueueMessages,
  QueueStorageBatchApplication,
  QueueStorageContext,
  QueueStorageMessage,
  QueueStorageMessageProcessingException,
  QueueStorageOptions,
  useBenzeneMessage,
  useQueueStorage,
} from '@benzenejs/azure-function-queue-storage';

/**
 * End-to-end port of the C# Azure Queue Storage pipeline tests (QueueStoragePipelineTest.cs +
 * QueueStorageFailureHandlingTest.cs): wire the full stack via idiomatic DI and feed queue messages
 * through the Azure Function entry point / `QueueStorageApplication` / message-handler pipeline. Queue
 * Storage is fire-and-forget (no response), like SQS / Service Bus / Event Hub.
 *
 * SHAPE note (faithful to the C# package): a Queue Storage message carries no properties for a topic to
 * ride on — the body is the entire message. So routing comes from either a Benzene message envelope in
 * the body (`useBenzeneMessage`, via `BenzeneMessageQueueStorageHandler`) or a fixed per-queue preset
 * topic (`usePresetTopic` + `useMessageHandlers`) over the raw payload.
 */

const TOPIC = 'create-order';

class Order {
  orderId: string | undefined;
}

class OrderCreated {
  reference: string | undefined;
}

// Records which orders reached the handler, proving the message genuinely routed to it.
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

// A Benzene message envelope, exactly as `BenzeneMessageQueueStorageHandler` deserializes it from the
// queue message text: `{ topic, headers, body }` with `body` the serialized payload.
function createEnvelopeMessageText(topic: string, payload: unknown): string {
  return JSON.stringify({ topic, headers: {}, body: JSON.stringify(payload) });
}

describe('QueueStoragePipeline (via AzureFunctionApp entry point)', () => {
  it('routes a Benzene message envelope by its envelope topic', async () => {
    handled.length = 0;

    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useQueueStorage(builder, (queue) =>
          useBenzeneMessage(queue, (direct) => useMessageHandlers(direct, CreateOrderHandler)),
        ),
      )
      .build();

    await handleQueueMessage(app, createEnvelopeMessageText(TOPIC, { orderId: '42' }));

    expect(handled).toEqual(['42']);
  });

  it('routes a raw payload by the preset topic (proves the addQueueStorage registration set is complete)', async () => {
    handled.length = 0;

    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useQueueStorage(builder, (queue) => {
          usePresetTopic(queue, TOPIC);
          useMessageHandlers(queue, CreateOrderHandler);
        }),
      )
      .build();

    // Raw payload, no envelope — the queue itself decides the topic.
    await handleQueueMessage(app, JSON.stringify({ orderId: '7' }));

    expect(handled).toEqual(['7']);
  });

  it('escalates a deferred non-envelope message by default (null outcome is retained)', async () => {
    handled.length = 0;

    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useQueueStorage(builder, (queue) =>
          useBenzeneMessage(queue, (direct) => useMessageHandlers(direct, CreateOrderHandler)),
        ),
      )
      .build();

    // The envelope handler defers (the text is no envelope), so no result is recorded — a
    // null/unestablished outcome. Per benzene-dotnet's work/settlement-consistency-fix-plan.md row 4
    // that now escalates by default: the message is retained for the host's maxDequeueCount/poison
    // handling rather than silently deleted.
    await expect(handleQueueMessage(app, 'just some text, not an envelope')).rejects.toThrow(
      QueueStorageMessageProcessingException,
    );
    expect(handled).toEqual([]);
  });

  it('defers a non-envelope message without error when raiseOnFailureStatus is disabled', async () => {
    handled.length = 0;

    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useQueueStorage(
          builder,
          (queue) =>
            useBenzeneMessage(queue, (direct) => useMessageHandlers(direct, CreateOrderHandler)),
          (options) => {
            options.raiseOnFailureStatus = false;
          },
        ),
      )
      .build();

    await handleQueueMessage(app, 'just some text, not an envelope');

    expect(handled).toEqual([]);
  });

  it('propagates a pipeline exception so the host retries and poisons', async () => {
    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useQueueStorage(builder, (queue) =>
          queue.useFn('Throw', () => {
            throw new Error('handler failed');
          }),
        ),
      )
      .build();

    await expect(handleQueueMessage(app, 'boom')).rejects.toThrow('handler failed');
  });

  it('exposes the message metadata on the context', async () => {
    let observed: QueueStorageContext | undefined;
    const insertedOn = new Date();

    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useQueueStorage(builder, (queue) =>
          queue.useFn('Capture', async (context, next) => {
            observed = context;
            // Record a success so the safe-by-default null-outcome escalation doesn't fire for this
            // observation-only pipeline.
            context.messageResult = { isSuccessful: true };
            await next();
          }),
        ),
      )
      .build();

    await handleQueueMessages(
      app,
      new QueueStorageMessage('some-text', { messageId: 'some-id', dequeueCount: 3, insertedOn }),
    );

    expect(observed).toBeDefined();
    expect(observed?.message.messageText).toBe('some-text');
    expect(observed?.message.messageId).toBe('some-id');
    expect(observed?.message.dequeueCount).toBe(3);
    expect(observed?.message.insertedOn).toBe(insertedOn);
  });

  it('escalates an envelope-handler failure to QueueStorageMessageProcessingException (raiseOnFailureStatus default)', async () => {
    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useQueueStorage(builder, (queue) =>
          useBenzeneMessage(queue, (direct) =>
            direct.useFn('Fail', (context) => {
              context.benzeneMessageResponse.statusCode = BenzeneResultStatus.serviceUnavailable;
              return Promise.resolve();
            }),
          ),
        ),
      )
      .build();

    // A failure recorded inside the (response-suppressed) envelope pipeline is surfaced to the outer
    // QueueStorageContext, so raiseOnFailureStatus (default true) escalates it into a thrown exception.
    await expect(
      handleQueueMessage(app, createEnvelopeMessageText(TOPIC, { orderId: '9' })),
    ).rejects.toThrow(QueueStorageMessageProcessingException);
  });

  it('does not escalate an envelope-handler failure when raiseOnFailureStatus is disabled', async () => {
    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useQueueStorage(
          builder,
          (queue) =>
            useBenzeneMessage(queue, (direct) =>
              direct.useFn('Fail', (context) => {
                context.benzeneMessageResponse.statusCode = BenzeneResultStatus.serviceUnavailable;
                return Promise.resolve();
              }),
            ),
          (options) => {
            options.raiseOnFailureStatus = false;
          },
        ),
      )
      .build();

    // Opt-out (at-most-once): a returned failure is accepted like a success, so nothing is thrown.
    await handleQueueMessage(app, createEnvelopeMessageText(TOPIC, { orderId: '9' }));
  });
});

describe('QueueStorageBatchApplication (direct)', () => {
  function createEvent(id = 'msg-1'): QueueStorageMessage[] {
    return [new QueueStorageMessage('body', { messageId: id })];
  }

  it('runs every message through the pipeline in its own scope, with the queue-storage transport', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addQueueStorage(container);

    const seenBodies: string[] = [];
    const seenTransports: string[] = [];
    const pipeline = new MiddlewarePipelineBuilder<QueueStorageContext>(container);
    pipeline.useFn(async (context, next, resolver) => {
      seenBodies.push(context.message.messageText);
      seenTransports.push(resolver.getService(ICurrentTransport).name);
      // Record a success so the safe-by-default escalation (a null outcome is retained for
      // redelivery, like a failure) doesn't fire for this observation-only pipeline.
      context.messageResult = { isSuccessful: true };
      await next();
    });

    const application = new QueueStorageBatchApplication(pipeline.build());
    await application.handleAsync(
      [new QueueStorageMessage('one'), new QueueStorageMessage('two')],
      container.createServiceResolverFactory(),
    );

    expect(seenBodies.sort()).toEqual(['one', 'two']);
    expect(seenTransports).toEqual(['queue-storage', 'queue-storage']);
  });

  it('default options: a handler exception cascades', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addQueueStorage(container);

    const pipeline = new MiddlewarePipelineBuilder<QueueStorageContext>(container);
    pipeline.useFn(() => {
      throw new Error('boom');
    });

    const application = new QueueStorageBatchApplication(pipeline.build());

    await expect(
      application.handleAsync(createEvent(), container.createServiceResolverFactory()),
    ).rejects.toThrow('boom');
  });

  it('raiseOnFailureStatus (default true): a handler failure result throws QueueStorageMessageProcessingException', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addQueueStorage(container);

    // A middleware that records a non-successful message result on the context, without throwing.
    const pipeline = new MiddlewarePipelineBuilder<QueueStorageContext>(container);
    pipeline.useFn(async (context, next) => {
      context.messageResult = { isSuccessful: false };
      await next();
    });

    const application = new QueueStorageBatchApplication(pipeline.build());

    const error = await application
      .handleAsync(createEvent('msg-2'), container.createServiceResolverFactory())
      .then(
        () => undefined,
        (e: unknown) => e,
      );

    expect(error).toBeInstanceOf(QueueStorageMessageProcessingException);
    expect((error as QueueStorageMessageProcessingException).messageId).toBe('msg-2');
  });

  it('QueueStorageOptions defaults: does not catch exceptions, escalates failure results', () => {
    const options = new QueueStorageOptions();
    expect(options.catchExceptions).toBe(false);
    expect(options.raiseOnFailureStatus).toBe(true);
  });
});
