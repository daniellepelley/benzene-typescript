import { describe, expect, it } from 'vitest';
import type { CreateBatchOptions, EventData, EventDataBatch, EventHubProducerClient } from '@azure/event-hubs';
import { addOutboundRouting, IBenzeneMessageSender, OutboundContext } from '@benzene/clients';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import {
  EventHubSendMessageContext,
  OutboundEventHubContextConverter,
  useEventHub,
} from '@benzene/clients-azure-event-hub';

/**
 * Port of the C# Benzene.Clients.Azure.EventHub tests (the OutboundContext send path — the generic
 * `EventHubContextConverter<T>`/`EventHubBenzeneMessageClient`/batch client are deferred, matching the
 * `@benzene/clients-*` siblings). Drives the send end-to-end from `IBenzeneMessageSender.sendAsync` over
 * a capturing fake `EventHubProducerClient` (createBatch → tryAdd → sendBatch), plus a converter unit test.
 */

class FakeBatch {
  readonly events: EventData[] = [];
  constructor(readonly partitionKey: string | undefined) {}
  tryAdd(eventData: EventData): boolean {
    this.events.push(eventData);
    return true;
  }
}

function capturingProducer(): { sent: FakeBatch[]; producer: EventHubProducerClient } {
  const sent: FakeBatch[] = [];
  const producer = {
    createBatch: (options?: CreateBatchOptions) =>
      Promise.resolve(new FakeBatch(options?.partitionKey) as unknown as EventDataBatch),
    sendBatch: (batch: EventDataBatch) => {
      sent.push(batch as unknown as FakeBatch);
      return Promise.resolve();
    },
  } as unknown as EventHubProducerClient;
  return { sent, producer };
}

function senderFor(
  configure: (routing: Parameters<Parameters<typeof addOutboundRouting>[1]>[0]) => void,
): IBenzeneMessageSender {
  const container = new DefaultBenzeneServiceContainer();
  addOutboundRouting(container, configure);
  return container.createServiceResolverFactory().createScope().getService(IBenzeneMessageSender);
}

describe('outbound Event Hub client', () => {
  it('sends the routed message as an event with the body serialized and topic + headers as properties', async () => {
    const { sent, producer } = capturingProducer();
    const sender = senderFor((routing) =>
      routing.route('telemetry:recorded', (p) => useEventHub(p, producer)),
    );

    const result = await sender.sendAsync('telemetry:recorded', { deviceId: 'd1' }, { tenant: 'acme' });

    expect(result.isSuccessful).toBe(true);
    expect(sent).toHaveLength(1);
    const event = sent[0]!.events[0]!;
    expect(JSON.parse(event.body as string)).toEqual({ deviceId: 'd1' });
    expect(event.properties!['topic']).toBe('telemetry:recorded');
    expect(event.properties!['tenant']).toBe('acme');
  });

  it('uses the configured header as the partition key on the batch', async () => {
    const { sent, producer } = capturingProducer();
    const sender = senderFor((routing) =>
      routing.route('telemetry:recorded', (p) => useEventHub(p, producer, 'topic', 'x-partition')),
    );

    await sender.sendAsync('telemetry:recorded', { deviceId: 'd2' }, { 'x-partition': 'device-42' });

    expect(sent[0]!.partitionKey).toBe('device-42');
  });
});

describe('OutboundEventHubContextConverter', () => {
  function outboundContext(topic: string, request: unknown, headers: Record<string, string>): OutboundContext {
    return new OutboundContext(topic, request, headers);
  }

  it('serializes the message as the body and sets the topic + headers as properties', async () => {
    const converter = new OutboundEventHubContextConverter();
    const context = await converter.createRequestAsync(
      outboundContext('telemetry:recorded', { id: 42, name: 'foo' }, { tenantId: 'tenant-1' }),
    );

    expect(context).toBeInstanceOf(EventHubSendMessageContext);
    expect(context.eventData.properties!['topic']).toBe('telemetry:recorded');
    expect(context.eventData.properties!['tenantId']).toBe('tenant-1');
    expect(context.eventData.body as string).toContain('foo');
    expect(context.partitionKey).toBeUndefined();
  });

  it('maps the response to an accepted result', async () => {
    const converter = new OutboundEventHubContextConverter();
    const contextIn = outboundContext('telemetry:recorded', { id: 42 }, {});
    const contextOut = await converter.createRequestAsync(contextIn);

    await converter.mapResponseAsync(contextIn, contextOut);

    expect((contextIn.response as { isSuccessful: boolean }).isSuccessful).toBe(true);
  });
});
