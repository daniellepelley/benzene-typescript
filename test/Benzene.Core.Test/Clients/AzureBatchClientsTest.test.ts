import { describe, expect, it } from 'vitest';
import { EventHubProducerClient } from '@azure/event-hubs';
import { ServiceBusSender } from '@azure/service-bus';
import { EventGridPublisherClient, InputSchema } from '@azure/eventgrid';
import { IBenzeneClientRequest } from '@benzenejs/abstractions-messages';
import { EventHubBatchMessageClient } from '@benzenejs/clients-azure-event-hub';
import { ServiceBusBatchMessageClient } from '@benzenejs/clients-azure-service-bus';
import { EventGridBatchMessageClient } from '@benzenejs/clients-azure-event-grid';

/**
 * The native-batch outbound clients for Azure: each event/message is built by the same converter the
 * single-send path uses, then packed into the provider's native batch (Event Hubs / Service Bus size-bounded
 * `tryAdd`, Event Grid count-chunked send). Failures are reported at batch granularity, mapped back to the
 * caller's index. The SDK objects are mocked.
 */
function req(topic: string, message: unknown, headers: Record<string, string> = {}): IBenzeneClientRequest<unknown> {
  return { topic, message, headers };
}

describe('EventHubBatchMessageClient', () => {
  // A fake producer whose batches accept up to `perBatch` events; sendBatch optionally throws, and
  // createBatch rejects on the (1-based) calls listed in `failCreateOn`.
  function fakeProducer(perBatch: number, throwOnSend = false, failCreateOn: number[] = []) {
    const sent: unknown[][] = [];
    let creates = 0;
    const producer = {
      createBatch: (_options?: unknown) => {
        creates++;
        if (failCreateOn.includes(creates)) {
          return Promise.reject(Object.assign(new Error('connect ECONNREFUSED'), { name: 'ServiceCommunicationError' }));
        }
        const events: unknown[] = [];
        return Promise.resolve({
          tryAdd: (e: unknown) => {
            if (events.length >= perBatch) {
              return false;
            }
            events.push(e);
            return true;
          },
          get count() {
            return events.length;
          },
          _events: events,
        });
      },
      sendBatch: (batch: { _events: unknown[] }) => {
        if (throwOnSend) {
          return Promise.reject(Object.assign(new Error('hub down'), { name: 'ServiceCommunicationError' }));
        }
        sent.push(batch._events);
        return Promise.resolve();
      },
    };
    return { producer, sent };
  }

  it('rolls to a new batch when the current one is full', async () => {
    const { producer, sent } = fakeProducer(2);
    const batch = new EventHubBatchMessageClient(producer as unknown as EventHubProducerClient);
    const result = await batch.sendBatchAsync([req('t', { a: 1 }), req('t', { a: 2 }), req('t', { a: 3 })]);

    expect(result.allSucceeded).toBe(true);
    // 3 events, 2 per batch → two sendBatch calls (2 + 1).
    expect(sent.map((b) => b.length)).toEqual([2, 1]);
  });

  it('groups by partition key so each batch is single-partition', async () => {
    const { producer, sent } = fakeProducer(10);
    const batch = new EventHubBatchMessageClient(
      producer as unknown as EventHubProducerClient,
      'topic',
      'pk', // the header whose value is the partition key
    );
    const result = await batch.sendBatchAsync([
      req('t', { a: 1 }, { pk: 'A' }),
      req('t', { a: 2 }, { pk: 'B' }),
      req('t', { a: 3 }, { pk: 'A' }),
    ]);

    expect(result.allSucceeded).toBe(true);
    // Two partition keys → two batches (A has 2 events, B has 1).
    expect(sent.map((b) => b.length).sort()).toEqual([1, 2]);
  });

  it('fails every event in a batch (against its index) when sendBatch throws', async () => {
    const { producer } = fakeProducer(10, true);
    const batch = new EventHubBatchMessageClient(producer as unknown as EventHubProducerClient);
    const result = await batch.sendBatchAsync([req('t', { a: 1 }), req('t', { a: 2 })]);

    expect(result.failures.map((f) => f.index)).toEqual([0, 1]);
    expect(result.failures[0]!.errorCode).toBe('ServiceCommunicationError');
  });

  it('fails every event (against its index) instead of throwing when createBatch rejects', async () => {
    const { producer, sent } = fakeProducer(10, false, [1]);
    const batch = new EventHubBatchMessageClient(producer as unknown as EventHubProducerClient);
    const result = await batch.sendBatchAsync([req('t', { a: 1 }), req('t', { a: 2 })]);

    expect(sent).toEqual([]);
    expect(result.allSucceeded).toBe(false);
    expect(result.failures.map((f) => f.index)).toEqual([0, 1]);
    expect(result.failures[0]!.errorCode).toBe('ServiceCommunicationError');
    expect(result.failures[0]!.errorMessage).toBe('connect ECONNREFUSED');
  });

  it('keeps the sent batch and fails the rest of the group when a rolled createBatch rejects', async () => {
    const { producer, sent } = fakeProducer(2, false, [2]);
    const batch = new EventHubBatchMessageClient(producer as unknown as EventHubProducerClient);
    const result = await batch.sendBatchAsync([req('t', { a: 1 }), req('t', { a: 2 }), req('t', { a: 3 }), req('t', { a: 4 })]);

    // The first batch (0, 1) went out; the roll for event 2 failed, so 2 and 3 were never sent.
    expect(sent.map((b) => b.length)).toEqual([2]);
    expect(result.failures.map((f) => f.index)).toEqual([2, 3]);
  });

  it('fails only the partition-key group whose createBatch rejects; other groups still send', async () => {
    const { producer, sent } = fakeProducer(10, false, [1]);
    const batch = new EventHubBatchMessageClient(producer as unknown as EventHubProducerClient, 'topic', 'pk');
    const result = await batch.sendBatchAsync([
      req('t', { a: 1 }, { pk: 'A' }),
      req('t', { a: 2 }, { pk: 'B' }),
      req('t', { a: 3 }, { pk: 'A' }),
    ]);

    // Group A is created first (insertion order) and fails; group B sends.
    expect(result.failures.map((f) => f.index)).toEqual([0, 2]);
    expect(sent.map((b) => b.length)).toEqual([1]);
  });
});

describe('ServiceBusBatchMessageClient', () => {
  // createMessageBatch rejects on the (1-based) calls listed in `failCreateOn`.
  function fakeSender(perBatch: number, throwOnSend = false, failCreateOn: number[] = []) {
    const sent: unknown[][] = [];
    let creates = 0;
    const sender = {
      createMessageBatch: () => {
        creates++;
        if (failCreateOn.includes(creates)) {
          return Promise.reject(Object.assign(new Error('connect ECONNREFUSED'), { name: 'ServiceBusError' }));
        }
        const messages: unknown[] = [];
        return Promise.resolve({
          tryAddMessage: (m: unknown) => {
            if (messages.length >= perBatch) {
              return false;
            }
            messages.push(m);
            return true;
          },
          get count() {
            return messages.length;
          },
          _messages: messages,
        });
      },
      sendMessages: (batch: { _messages: unknown[] }) => {
        if (throwOnSend) {
          return Promise.reject(Object.assign(new Error('bus down'), { name: 'ServiceBusError' }));
        }
        sent.push(batch._messages);
        return Promise.resolve();
      },
    };
    return { sender, sent };
  }

  it('packs into size-bounded batches and reports all-success', async () => {
    const { sender, sent } = fakeSender(2);
    const batch = new ServiceBusBatchMessageClient(sender as unknown as ServiceBusSender);
    const result = await batch.sendBatchAsync([req('t', { a: 1 }), req('t', { a: 2 }), req('t', { a: 3 })]);

    expect(result.allSucceeded).toBe(true);
    expect(sent.map((b) => b.length)).toEqual([2, 1]);
  });

  it('fails a batch atomically (each index) when sendMessages throws', async () => {
    const { sender } = fakeSender(10, true);
    const batch = new ServiceBusBatchMessageClient(sender as unknown as ServiceBusSender);
    const result = await batch.sendBatchAsync([req('t', { a: 1 }), req('t', { a: 2 })]);

    expect(result.failures.map((f) => f.index)).toEqual([0, 1]);
    expect(result.failures[0]!.errorCode).toBe('ServiceBusError');
  });

  it('fails every message (against its index) instead of throwing when createMessageBatch rejects', async () => {
    const { sender, sent } = fakeSender(10, false, [1]);
    const batch = new ServiceBusBatchMessageClient(sender as unknown as ServiceBusSender);
    const result = await batch.sendBatchAsync([req('t', { a: 1 }), req('t', { a: 2 }), req('t', { a: 3 })]);

    expect(sent).toEqual([]);
    expect(result.allSucceeded).toBe(false);
    expect(result.failures.map((f) => f.index)).toEqual([0, 1, 2]);
    expect(result.failures[0]!.errorCode).toBe('ServiceBusError');
    expect(result.failures[0]!.errorMessage).toBe('connect ECONNREFUSED');
  });

  it('keeps the sent batch and fails the rest when a rolled createMessageBatch rejects', async () => {
    const { sender, sent } = fakeSender(2, false, [2]);
    const batch = new ServiceBusBatchMessageClient(sender as unknown as ServiceBusSender);
    const result = await batch.sendBatchAsync([req('t', { a: 1 }), req('t', { a: 2 }), req('t', { a: 3 }), req('t', { a: 4 })]);

    // The first batch (0, 1) went out; the roll for message 2 failed, so 2 and 3 were never sent.
    expect(sent.map((b) => b.length)).toEqual([2]);
    expect(result.failures.map((f) => f.index)).toEqual([2, 3]);
  });

  it('resolves with every entry failed when createMessageBatch throws synchronously', async () => {
    const sender = {
      createMessageBatch: () => {
        throw Object.assign(new Error('sender closed'), { name: 'ServiceBusError' });
      },
      sendMessages: () => Promise.resolve(),
    };
    const batch = new ServiceBusBatchMessageClient(sender as unknown as ServiceBusSender);
    const result = await batch.sendBatchAsync([req('t', { a: 1 }), req('t', { a: 2 })]);

    expect(result.failures.map((f) => [f.index, f.errorMessage])).toEqual([
      [0, 'sender closed'],
      [1, 'sender closed'],
    ]);
  });
});

describe('EventGridBatchMessageClient', () => {
  function fakePublisher(throwOnSend = false) {
    const sent: unknown[][] = [];
    const client = {
      send: (events: unknown[]) => {
        if (throwOnSend) {
          return Promise.reject(Object.assign(new Error('grid down'), { name: 'RestError' }));
        }
        sent.push(events);
        return Promise.resolve();
      },
    };
    return { client, sent };
  }

  it('chunks to the batch size and sends CloudEvents whose type is the topic', async () => {
    const { client, sent } = fakePublisher();
    const batch = new EventGridBatchMessageClient('orders.service', client as unknown as EventGridPublisherClient<InputSchema>, 2);
    const result = await batch.sendBatchAsync([
      req('orders:created', { id: 1 }),
      req('orders:created', { id: 2 }),
      req('orders:created', { id: 3 }),
    ]);

    expect(result.allSucceeded).toBe(true);
    expect(sent.map((c) => c.length)).toEqual([2, 1]);
    const first = sent[0] as { type: string }[];
    expect(first[0]!.type).toBe('orders:created');
  });

  it('fails a chunk atomically (each index) when send throws', async () => {
    const { client } = fakePublisher(true);
    const batch = new EventGridBatchMessageClient('orders.service', client as unknown as EventGridPublisherClient<InputSchema>);
    const result = await batch.sendBatchAsync([req('t', { id: 1 }), req('t', { id: 2 })]);

    expect(result.failures.map((f) => f.index)).toEqual([0, 1]);
    expect(result.failures[0]!.errorCode).toBe('RestError');
  });
});
