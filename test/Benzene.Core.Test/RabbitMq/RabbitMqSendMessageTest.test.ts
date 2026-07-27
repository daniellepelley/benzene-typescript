import { describe, expect, it, vi } from 'vitest';
import type { Channel, Options } from 'amqplib';
import { VoidResult } from '@benzene/abstractions';
import { IBenzeneClientContext } from '@benzene/abstractions-messages';
import { MiddlewarePipelineBuilder, NullBenzeneServiceContainer } from '@benzene/core-middleware';
import { sendMessageAsync } from '@benzene/clients';
import { BenzeneResultStatus } from '@benzene/results';
import {
  RabbitMqBenzeneMessageClient,
  RabbitMqClientMiddleware,
  RabbitMqContextConverter,
  RabbitMqSendMessageContext,
  useRabbitMqClient,
} from '@benzene/rabbitmq';

/**
 * Port of the C# RabbitMqBenzeneMessageClientTest. The message client is driven over a FAKE amqplib
 * `Channel` (no live broker): we capture the arguments of `channel.publish` (exchange, routing key,
 * body, options) and assert on them and on the mapped Benzene status.
 *
 * SDK-MAPPING BEND under test: C# awaits `IChannel.BasicPublishAsync(exchange, routingKey, mandatory,
 * BasicProperties, body)`; amqplib's `Channel.publish(exchange, routingKey, content, options)` is
 * synchronous, and `BasicProperties.{Headers,Persistent}` map to `options.{headers,persistent}`.
 */

interface CapturedPublish {
  exchange: string;
  routingKey: string;
  content: Buffer;
  options: Options.Publish | undefined;
}

function fakeChannel(
  behaviour: { throws?: Error } = {},
): { channel: Channel; captured(): CapturedPublish | undefined } {
  let captured: CapturedPublish | undefined;
  const publish = vi.fn(
    (exchange: string, routingKey: string, content: Buffer, options?: Options.Publish): boolean => {
      if (behaviour.throws) {
        throw behaviour.throws;
      }
      captured = { exchange, routingKey, content, options };
      return true;
    },
  );
  const channel = { publish } as unknown as Channel;
  return { channel, captured: () => captured };
}

function headerString(options: Options.Publish | undefined, key: string): string {
  return Buffer.from((options?.headers as Record<string, Buffer>)[key]).toString('utf8');
}

describe('RabbitMqBenzeneMessageClient', () => {
  it('returns Accepted when the publish succeeds', async () => {
    const { channel } = fakeChannel();
    const client = new RabbitMqBenzeneMessageClient(channel);

    const result = await sendMessageAsync(client, 'some-topic', 'some-message');

    expect(result.status).toBe(BenzeneResultStatus.accepted);
  });

  it('publishes persistently by default', async () => {
    const { channel, captured } = fakeChannel();
    const client = new RabbitMqBenzeneMessageClient(channel);

    await sendMessageAsync(client, 'some-topic', 'some-message');

    expect(captured()?.options?.persistent).toBe(true);
  });

  it('returns ServiceUnavailable when the channel throws', async () => {
    const { channel } = fakeChannel({ throws: new Error('boom') });
    const client = new RabbitMqBenzeneMessageClient(channel);

    const result = await sendMessageAsync(client, 'some-topic', 'some-message');

    expect(result.status).toBe(BenzeneResultStatus.serviceUnavailable);
  });

  it('publishes to the topic as routing key on the configured exchange, forwarding headers and the topic header', async () => {
    const { channel, captured } = fakeChannel();
    const client = new RabbitMqBenzeneMessageClient(channel, undefined, undefined, 'events');

    await sendMessageAsync(client, 'orderCreated', 'some-message', { 'correlation-id': 'abc-123' });

    const publish = captured();
    expect(publish?.exchange).toBe('events');
    expect(publish?.routingKey).toBe('orderCreated');
    expect(headerString(publish?.options, 'correlation-id')).toBe('abc-123');
    // The topic is forwarded as a header too, so a Benzene consumer's header-first topic getter round-trips it.
    expect(headerString(publish?.options, 'topic')).toBe('orderCreated');
  });

  it('writes the topic to a custom topic-header key and not the default "topic"', async () => {
    const { channel, captured } = fakeChannel();
    // exchange default '', mandatory default false, custom topicHeaderKey.
    const client = new RabbitMqBenzeneMessageClient(channel, undefined, undefined, '', false, 'x-my-topic');

    await sendMessageAsync(client, 'orderCreated', 'some-message');

    const options = captured()?.options;
    expect(headerString(options, 'x-my-topic')).toBe('orderCreated');
    expect((options?.headers as Record<string, unknown>)['topic']).toBeUndefined();
  });

  it('works over a prebuilt pipeline (the testing constructor)', async () => {
    const { channel } = fakeChannel();
    const pipeline = useRabbitMqClient(
      new MiddlewarePipelineBuilder<RabbitMqSendMessageContext>(new NullBenzeneServiceContainer()),
      channel,
    ).build();
    const client = new RabbitMqBenzeneMessageClient(pipeline);

    const result = await sendMessageAsync(client, 'some-topic', 'some-message');

    expect(result.status).toBe(BenzeneResultStatus.accepted);
  });
});

describe('RabbitMqClientMiddleware', () => {
  it('publishes the context body/headers and marks the context published', async () => {
    const { channel, captured } = fakeChannel();
    const context = new RabbitMqSendMessageContext('events', 'orderCreated', Buffer.from('body', 'utf8'), {
      'correlation-id': Buffer.from('abc', 'utf8'),
    });

    await new RabbitMqClientMiddleware(channel, true, false).handleAsync(context, () => Promise.resolve());

    const publish = captured();
    expect(publish?.exchange).toBe('events');
    expect(publish?.routingKey).toBe('orderCreated');
    expect(publish?.content.toString('utf8')).toBe('body');
    expect(publish?.options?.mandatory).toBe(true);
    expect(publish?.options?.persistent).toBe(false);
    expect(context.published).toBe(true);
  });
});

describe('RabbitMqContextConverter', () => {
  it('serializes the body, uses the topic as routing key, and carries the topic header', async () => {
    const converter = new RabbitMqContextConverter<{ reference: string }>(undefined, 'events');
    const context = await converter.createRequestAsync({
      request: { topic: 'orderCreated', message: { reference: 'r1' }, headers: { 'k': 'v' } },
      response: undefined!,
    });

    expect(context.exchange).toBe('events');
    expect(context.routingKey).toBe('orderCreated');
    expect(context.body.toString('utf8')).toBe(JSON.stringify({ reference: 'r1' }));
    expect(Buffer.from(context.headers['k'] as Buffer).toString('utf8')).toBe('v');
    expect(Buffer.from(context.headers['topic'] as Buffer).toString('utf8')).toBe('orderCreated');
  });

  it('maps published/unpublished to Accepted/ServiceUnavailable', async () => {
    const converter = new RabbitMqContextConverter<string>();
    const clientContext: IBenzeneClientContext<string, VoidResult> = {
      request: { topic: 't', message: 'v', headers: {} },
      response: undefined!,
    };

    const published = new RabbitMqSendMessageContext('', 't', Buffer.from('v'), {});
    published.published = true;
    await converter.mapResponseAsync(clientContext, published);
    expect(clientContext.response.status).toBe(BenzeneResultStatus.accepted);

    const unpublished = new RabbitMqSendMessageContext('', 't', Buffer.from('v'), {});
    await converter.mapResponseAsync(clientContext, unpublished);
    expect(clientContext.response.status).toBe(BenzeneResultStatus.serviceUnavailable);
  });
});
