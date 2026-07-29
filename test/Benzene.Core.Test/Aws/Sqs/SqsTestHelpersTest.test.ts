/**
 * Port-verification test for `@benzene/aws-sqs-test-helpers` (ports Benzene.Aws.Sqs.TestHelpers).
 * The C# original ships only the `AsSqsMessage()` builder (no `*BenzeneTestHost`), and the C#
 * `SqsConsumerMessagePipelineTest` drives the built message through a `SqsConsumerApplication` directly.
 * The port mirrors that shape: build the real DI pipeline `useSqs` builds, wrap a native
 * `asSqsMessage(...)` in a receive batch, and run it through the application — asserting the record
 * succeeded AND the egress the handler published through a faked outbound client.
 */
import { describe, expect, it } from 'vitest';
import type { Message, ReceiveMessageCommandOutput } from '@aws-sdk/client-sqs';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { BenzeneResult } from '@benzene/results';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { IBenzeneMessageSender } from '@benzene/clients';
import { addSqsConsumer, SqsConsumerApplication, SqsConsumerMessageContext } from '@benzene/aws-sqs';
import { FakeBenzeneMessageSender, messageBuilder } from '@benzene/testing';
import { asSqsMessage } from '@benzene/aws-sqs-test-helpers';

const Topics = { placeOrder: 'order:place', orderCreated: 'order:created' } as const;

class PlaceOrder {
  name?: string;
}

class OrderDto {
  name?: string;
}

const registry = new MessageHandlersRegistry();

@message(Topics.placeOrder, { registry, requestType: PlaceOrder, responseType: OrderDto })
class PlaceOrderHandler implements IMessageHandler<PlaceOrder, OrderDto> {
  static readonly inject = [IBenzeneMessageSender];

  constructor(private readonly sender: IBenzeneMessageSender) {}

  async handleAsync(request: PlaceOrder): Promise<IBenzeneResultOf<OrderDto>> {
    await this.sender.sendAsync(Topics.orderCreated, { name: request.name });
    return BenzeneResult.ok<OrderDto>({ name: request.name });
  }
}

describe('asSqsMessage drives the standalone SQS consumer pipeline', () => {
  it('routes a native SQS message to the handler and deletes it as a successful message', async () => {
    const fake = new FakeBenzeneMessageSender();

    // Build the same DI graph `useSqs` builds for a real worker, with the outbound client faked.
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addSqsConsumer(container);
    container.addSingletonInstance(IBenzeneMessageSender, fake);

    const pipeline = new MiddlewarePipelineBuilder<SqsConsumerMessageContext>(container);
    useMessageHandlers(pipeline, PlaceOrderHandler);
    const application = new SqsConsumerApplication(pipeline.build());

    const event = {
      Messages: [asSqsMessage(messageBuilder(Topics.placeOrder, { name: 'acme' }))],
    } as ReceiveMessageCommandOutput;

    const batchResult = await application.handleAsync(event, container.createServiceResolverFactory());

    // The record succeeded (native batch response out)...
    expect(batchResult.successfulMessages).toHaveLength(1);
    expect(batchResult.failedMessages).toHaveLength(0);
    // ...and the egress the handler published through the faked client.
    expect(fake.lastTopic).toBe(Topics.orderCreated);
    expect(fake.lastRequest).toMatchObject({ name: 'acme' });
  });
});

describe('asSqsMessage', () => {
  it('carries the topic + headers as String message attributes and the serialized body', () => {
    const built: Message = asSqsMessage(
      messageBuilder(Topics.placeOrder, { name: 'acme' }).withHeader('tenant', 'acme-co'),
    );

    expect(built.MessageAttributes?.['topic']?.StringValue).toBe(Topics.placeOrder);
    expect(built.MessageAttributes?.['topic']?.DataType).toBe('String');
    expect(built.MessageAttributes?.['tenant']?.StringValue).toBe('acme-co');
    expect(built.Body).toBe(JSON.stringify({ name: 'acme' }));
  });
});
