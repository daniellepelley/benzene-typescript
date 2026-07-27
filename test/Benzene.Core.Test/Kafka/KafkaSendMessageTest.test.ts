import { describe, expect, it, vi } from 'vitest';
import type { Message, Producer, ProducerRecord, RecordMetadata } from 'kafkajs';
import { VoidResult } from '@benzene/abstractions';
import { IBenzeneClientContext, ITopic } from '@benzene/abstractions-messages';
import { IMessageBodyGetter, IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import { IBenzeneResponseAdapter, IMessageHandlerResultSetter } from '@benzene/abstractions-message-handlers';
import { MiddlewarePipelineBuilder, NullBenzeneServiceContainer } from '@benzene/core-middleware';
import { Topic } from '@benzene/core-messages';
import { sendMessageAsync } from '@benzene/clients';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import {
  KafkaBenzeneMessageClient,
  KafkaClientMiddleware,
  KafkaContextConverter,
  KafkaMessageContextConverter,
  KafkaSendMessageBodyGetter,
  KafkaSendMessageContext,
  KafkaSendMessageHeadersGetter,
  KafkaSendMessageTopicGetter,
  useKafkaClient,
} from '@benzene/kafka-core';

/**
 * Port of the C# Benzene send-side Kafka tests (KafkaBenzeneMessageClientTest and the send-side portions
 * of KafkaCoreMappersTest). The message client is driven over a FAKE kafkajs `Producer` (no live broker):
 * we assert on the `ProducerRecord` produced (topic/key/value/headers) and on the mapped Benzene status.
 *
 * SDK-MAPPING BEND under test: the C# `DeliveryResult.Status == PersistenceStatus.Persisted` maps to a
 * resolved `producer.send` whose `RecordMetadata.errorCode` is `0`; a non-zero errorCode is "not
 * persisted" and a rejected send is a transport failure.
 */

function metadata(errorCode: number): RecordMetadata {
  return { topicName: 'some-topic', partition: 0, errorCode };
}

/** A fake kafkajs Producer whose `send` returns the given metadata (or throws). Records the last record. */
function fakeProducer(
  behaviour: { persisted: boolean } | { throws: Error },
): { producer: Producer; lastRecord(): ProducerRecord | undefined } {
  let last: ProducerRecord | undefined;
  const send = vi.fn(async (record: ProducerRecord): Promise<RecordMetadata[]> => {
    last = record;
    if ('throws' in behaviour) {
      throw behaviour.throws;
    }
    return [metadata(behaviour.persisted ? 0 : 1)];
  });
  const producer = { send } as unknown as Producer;
  return { producer, lastRecord: () => last };
}

describe('KafkaBenzeneMessageClient', () => {
  it('returns Accepted when the produce is persisted', async () => {
    const { producer } = fakeProducer({ persisted: true });
    const client = new KafkaBenzeneMessageClient(producer);

    const result = await sendMessageAsync(client, 'some-topic', 'some-message');

    expect(result.status).toBe(BenzeneResultStatus.accepted);
  });

  it('returns UnexpectedError when the produce is not persisted', async () => {
    const { producer } = fakeProducer({ persisted: false });
    const client = new KafkaBenzeneMessageClient(producer);

    const result = await sendMessageAsync(client, 'some-topic', 'some-message');

    expect(result.status).toBe(BenzeneResultStatus.unexpectedError);
  });

  it('returns ServiceUnavailable when the producer throws', async () => {
    const { producer } = fakeProducer({ throws: new Error('boom') });
    const client = new KafkaBenzeneMessageClient(producer);

    const result = await sendMessageAsync(client, 'some-topic', 'some-message');

    expect(result.status).toBe(BenzeneResultStatus.serviceUnavailable);
  });

  it('produces to the request topic with the serialized body and forwarded headers', async () => {
    const { producer, lastRecord } = fakeProducer({ persisted: true });
    const client = new KafkaBenzeneMessageClient(producer);

    await sendMessageAsync(client, 'orderCreated', { reference: 'abc' }, { 'correlation-id': 'xyz-1' });

    const record = lastRecord();
    expect(record?.topic).toBe('orderCreated');
    const message = record?.messages[0] as Message;
    expect(message.value).toBe(JSON.stringify({ reference: 'abc' }));
    expect(Buffer.from(message.headers?.['correlation-id'] as Buffer).toString('utf8')).toBe('xyz-1');
  });

  it('works over a prebuilt pipeline (the testing constructor)', async () => {
    const { producer } = fakeProducer({ persisted: true });
    const pipeline = useKafkaClient(
      new MiddlewarePipelineBuilder<KafkaSendMessageContext>(new NullBenzeneServiceContainer()),
      producer,
    ).build();
    const client = new KafkaBenzeneMessageClient(pipeline);

    const result = await sendMessageAsync(client, 'some-topic', 'some-message');

    expect(result.status).toBe(BenzeneResultStatus.accepted);
  });
});

describe('KafkaClientMiddleware', () => {
  it('sets the context response from the producer and does not call next', async () => {
    const { producer, lastRecord } = fakeProducer({ persisted: true });
    const context = new KafkaSendMessageContext('my-topic', { value: 'hello' });

    let nextCalled = false;
    await new KafkaClientMiddleware(producer).handleAsync(context, () => {
      nextCalled = true;
      return Promise.resolve();
    });

    expect(context.response?.[0].errorCode).toBe(0);
    expect(lastRecord()?.topic).toBe('my-topic');
    expect(nextCalled).toBe(false);
  });
});

describe('Kafka send-side getters', () => {
  it('KafkaSendMessageBodyGetter returns the message value', () => {
    const context = new KafkaSendMessageContext('my-topic', { value: 'hello' });
    expect(new KafkaSendMessageBodyGetter().getBody(context)).toBe('hello');
  });

  it('KafkaSendMessageTopicGetter returns the context topic', () => {
    const context = new KafkaSendMessageContext('my-topic', { value: 'hello' });
    expect(new KafkaSendMessageTopicGetter().getTopic(context)?.id).toBe('my-topic');
  });

  it('KafkaSendMessageHeadersGetter decodes UTF-8 header values', () => {
    const context = new KafkaSendMessageContext('my-topic', {
      value: 'hello',
      headers: { traceparent: Buffer.from('abc-123', 'utf8') },
    });
    expect(new KafkaSendMessageHeadersGetter().getHeaders(context).traceparent).toBe('abc-123');
  });

  it('KafkaSendMessageHeadersGetter takes the last value for a duplicate (array) header key', () => {
    const context = new KafkaSendMessageContext('my-topic', {
      value: 'hello',
      headers: { trace: [Buffer.from('a', 'utf8'), Buffer.from('b', 'utf8')] },
    });
    expect(new KafkaSendMessageHeadersGetter().getHeaders(context).trace).toBe('b');
  });
});

describe('KafkaContextConverter', () => {
  it('serializes the message onto the send context at the request topic', async () => {
    const converter = new KafkaContextConverter<string>();
    const built = await converter.createRequestAsync({
      request: { topic: 't', message: 'v', headers: {} },
      response: undefined!,
    });
    expect(built.topic).toBe('t');
    expect(built.message.value).toBe('"v"');
  });

  it('maps a persisted response to Accepted and a not-persisted response to ServiceUnavailable', async () => {
    const converter = new KafkaContextConverter<string>();
    const clientContext: IBenzeneClientContext<string, VoidResult> = {
      request: { topic: 't', message: 'v', headers: {} },
      response: undefined!,
    };

    const persisted = new KafkaSendMessageContext('t', { value: 'v' });
    persisted.response = [metadata(0)];
    await converter.mapResponseAsync(clientContext, persisted);
    expect(clientContext.response.status).toBe(BenzeneResultStatus.accepted);

    const notPersisted = new KafkaSendMessageContext('t', { value: 'v' });
    notPersisted.response = [metadata(1)];
    await converter.mapResponseAsync(clientContext, notPersisted);
    expect(clientContext.response.status).toBe(BenzeneResultStatus.serviceUnavailable);
  });

  it('sets the Kafka message key from the configured key header', async () => {
    const converter = new KafkaContextConverter<string>(undefined, 'partition-key');
    const built = await converter.createRequestAsync({
      request: { topic: 't', message: 'v', headers: { 'partition-key': 'order-42' } },
      response: undefined!,
    });
    expect(built.message.key).toBe('order-42');
  });
});

describe('KafkaMessageContextConverter (forwarding converter)', () => {
  const topicGetter: IMessageTopicGetter<string> = { getTopic: (c) => (c === 'ctx' ? new Topic('my-topic') : undefined) };
  const bodyGetter: IMessageBodyGetter<string> = { getBody: () => 'hello' };
  const headersGetter: IMessageHeadersGetter<string> = { getHeaders: () => ({ 'correlation-id': 'x', topic: 'should-be-dropped' }) };
  const resultSetter: IMessageHandlerResultSetter<string> = { setResultAsync: () => Promise.resolve() };

  it('maps topic and body from the registered getters and drops the routing "topic" header', async () => {
    const converter = new KafkaMessageContextConverter<string>(
      topicGetter,
      bodyGetter,
      headersGetter,
      resultSetter,
      undefined,
    );

    const sendContext = await converter.createRequestAsync('ctx');

    expect(sendContext.topic).toBe('my-topic');
    expect(sendContext.message.value).toBe('hello');
    expect(sendContext.message.headers?.['topic']).toBeUndefined();
    expect(Buffer.from(sendContext.message.headers?.['correlation-id'] as Buffer).toString('utf8')).toBe('x');
  });

  it('throws when the topic getter returns undefined', async () => {
    const noTopic: IMessageTopicGetter<string> = { getTopic: (): ITopic | undefined => undefined };
    const converter = new KafkaMessageContextConverter<string>(noTopic, bodyGetter, headersGetter, resultSetter, undefined);

    // The converter validates and throws synchronously (the method is not `async`), matching the C#
    // non-async `CreateRequestAsync` that throws before returning its Task.
    expect(() => converter.createRequestAsync('ctx')).toThrow();
  });

  it('reflects success via the response adapter when present', async () => {
    let statusCode: string | undefined;
    const adapter = {
      setStatusCode: (_c: string, s: string) => {
        statusCode = s;
      },
    } as unknown as IBenzeneResponseAdapter<string>;
    const converter = new KafkaMessageContextConverter<string>(topicGetter, bodyGetter, headersGetter, resultSetter, adapter);

    await converter.mapResponseAsync('ctx', new KafkaSendMessageContext('my-topic', { value: 'hello' }));

    expect(statusCode).toBe(BenzeneResultStatus.ok);
  });

  it('reflects success via the result setter when there is no response adapter', async () => {
    let received = false;
    const capturingSetter: IMessageHandlerResultSetter<string> = {
      setResultAsync: (_c, r) => {
        received = BenzeneResult.set(BenzeneResultStatus.ok).status === r.benzeneResult.status;
        return Promise.resolve();
      },
    };
    const converter = new KafkaMessageContextConverter<string>(topicGetter, bodyGetter, headersGetter, capturingSetter, undefined);

    await converter.mapResponseAsync('ctx', new KafkaSendMessageContext('my-topic', { value: 'hello' }));

    expect(received).toBe(true);
  });
});
