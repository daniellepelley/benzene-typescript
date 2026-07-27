import { describe, expect, it } from 'vitest';
import type {
  EventGridPublisherClient,
  InputSchema,
  SendCloudEventInput,
  SendEventGridEventInput,
} from '@azure/eventgrid';
import { addOutboundRouting, IBenzeneMessageSender, OutboundContext } from '@benzene/clients';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import {
  EventGridSendMessageContext,
  OutboundEventGridContextConverter,
  OutboundEventGridEventSchemaContextConverter,
  useEventGrid,
  useEventGridEventSchema,
} from '@benzene/clients-azure-event-grid';

/**
 * Port of the C# Benzene.Clients.Azure.EventGrid tests (the OutboundContext send path — the generic
 * `EventGridContextConverter<T>`/message+batch clients are deferred, matching the `@benzene/clients-*`
 * siblings). Both schemas are covered: CloudEvents 1.0 (`useEventGrid`) and the classic schema
 * (`useEventGridEventSchema`), driven end-to-end over a capturing fake `EventGridPublisherClient`.
 */

type AnyEvent = SendCloudEventInput<unknown> | SendEventGridEventInput<unknown>;

function capturingPublisher(): { sent: AnyEvent[]; client: EventGridPublisherClient<InputSchema> } {
  const sent: AnyEvent[] = [];
  const client = {
    send: (events: AnyEvent[]) => {
      sent.push(...events);
      return Promise.resolve();
    },
  } as unknown as EventGridPublisherClient<InputSchema>;
  return { sent, client };
}

function senderFor(
  configure: (routing: Parameters<Parameters<typeof addOutboundRouting>[1]>[0]) => void,
): IBenzeneMessageSender {
  const container = new DefaultBenzeneServiceContainer();
  addOutboundRouting(container, configure);
  return container.createServiceResolverFactory().createScope().getService(IBenzeneMessageSender);
}

describe('outbound Event Grid client (CloudEvents schema)', () => {
  it('sends a CloudEvent: topic -> type, source, body -> data, headers -> extension attributes', async () => {
    const { sent, client } = capturingPublisher();
    const sender = senderFor((routing) =>
      routing.route('order:placed', (p) => useEventGrid(p, client, 'orders-api')),
    );

    const result = await sender.sendAsync('order:placed', { orderId: 'o1' }, { TenantId: 'acme' });

    expect(result.isSuccessful).toBe(true);
    expect(sent).toHaveLength(1);
    const event = sent[0]! as SendCloudEventInput<unknown>;
    expect(event.type).toBe('order:placed');
    expect(event.source).toBe('orders-api');
    expect(event.data).toEqual({ orderId: 'o1' });
    // Header keys are lower-cased for CloudEvent extension attributes.
    expect(event.extensionAttributes!['tenantid']).toBe('acme');
  });
});

describe('outbound Event Grid client (classic schema)', () => {
  it('sends an Event Grid event: topic -> subject + eventType, body -> data', async () => {
    const { sent, client } = capturingPublisher();
    const sender = senderFor((routing) =>
      routing.route('order:placed', (p) => useEventGridEventSchema(p, client)),
    );

    const result = await sender.sendAsync('order:placed', { orderId: 'o2' });

    expect(result.isSuccessful).toBe(true);
    const event = sent[0]! as SendEventGridEventInput<unknown>;
    expect(event.subject).toBe('order:placed');
    expect(event.eventType).toBe('order:placed');
    expect(event.dataVersion).toBe('1.0');
    expect(event.data).toEqual({ orderId: 'o2' });
  });
});

describe('Event Grid converters', () => {
  function outboundContext(topic: string, request: unknown, headers: Record<string, string>): OutboundContext {
    return new OutboundContext(topic, request, headers);
  }

  it('CloudEvents converter builds a CloudEvent and maps an accepted response', async () => {
    const converter = new OutboundEventGridContextConverter('orders-api');
    const contextIn = outboundContext('order:placed', { id: 42 }, { Foo: 'bar' });
    const context = await converter.createRequestAsync(contextIn);

    expect(context).toBeInstanceOf(EventGridSendMessageContext);
    expect(context.cloudEvent!.type).toBe('order:placed');
    expect(context.cloudEvent!.extensionAttributes!['foo']).toBe('bar');
    expect(context.eventGridEvent).toBeUndefined();

    await converter.mapResponseAsync(contextIn, context);
    expect((contextIn.response as { isSuccessful: boolean }).isSuccessful).toBe(true);
  });

  it('classic-schema converter builds an EventGridEvent and maps an accepted response', async () => {
    const converter = new OutboundEventGridEventSchemaContextConverter();
    const contextIn = outboundContext('order:placed', { id: 42 }, {});
    const context = await converter.createRequestAsync(contextIn);

    expect(context.eventGridEvent!.subject).toBe('order:placed');
    expect(context.cloudEvent).toBeUndefined();

    await converter.mapResponseAsync(contextIn, context);
    expect((contextIn.response as { isSuccessful: boolean }).isSuccessful).toBe(true);
  });
});
