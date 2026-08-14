import { describe, expect, it } from 'vitest';
import type { ServiceBusMessage, ServiceBusSender } from '@azure/service-bus';
import { addOutboundRouting, IBenzeneMessageSender, OutboundContext } from '@benzenejs/clients';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import {
  OutboundServiceBusContextConverter,
  ServiceBusSendMessageContext,
  useServiceBus,
} from '@benzenejs/clients-azure-service-bus';

/**
 * Port of the C# Benzene.Clients.Azure.ServiceBus tests (the OutboundContext send path — the generic
 * `ServiceBusContextConverter<T>`/`ServiceBusBenzeneMessageClient`/batch client are deferred, matching the
 * `@benzenejs/clients-aws-*` siblings). Drives the send end-to-end from `IBenzeneMessageSender.sendAsync`
 * over a capturing fake `ServiceBusSender`, plus a direct converter unit test.
 */

function capturingSender(): { sent: ServiceBusMessage[]; sender: ServiceBusSender } {
  const sent: ServiceBusMessage[] = [];
  const sender = {
    sendMessages: (messages: ServiceBusMessage | ServiceBusMessage[]) => {
      sent.push(...(Array.isArray(messages) ? messages : [messages]));
      return Promise.resolve();
    },
  } as unknown as ServiceBusSender;
  return { sent, sender };
}

function senderFor(
  configure: (routing: Parameters<Parameters<typeof addOutboundRouting>[1]>[0]) => void,
): IBenzeneMessageSender {
  const container = new DefaultBenzeneServiceContainer();
  addOutboundRouting(container, configure);
  return container.createServiceResolverFactory().createScope().getService(IBenzeneMessageSender);
}

describe('outbound Service Bus client', () => {
  it('sends the routed message with the body serialized and topic + headers as applicationProperties', async () => {
    const { sent, sender: sbSender } = capturingSender();
    const sender = senderFor((routing) =>
      routing.route('orders:placed', (p) => useServiceBus(p, sbSender)),
    );

    const result = await sender.sendAsync('orders:placed', { orderId: 'o1' }, { tenant: 'acme' });

    expect(result.isSuccessful).toBe(true);
    expect(sent).toHaveLength(1);
    const message = sent[0]!;
    expect(JSON.parse(message.body as string)).toEqual({ orderId: 'o1' });
    expect(message.applicationProperties!['topic']).toBe('orders:placed');
    expect(message.applicationProperties!['tenant']).toBe('acme');
  });

  it('writes the topic to a custom application-property key when configured', async () => {
    const { sent, sender: sbSender } = capturingSender();
    const sender = senderFor((routing) =>
      routing.route('orders:placed', (p) => useServiceBus(p, sbSender, 'x-topic')),
    );

    await sender.sendAsync('orders:placed', { orderId: 'o2' });

    expect(sent[0]!.applicationProperties!['x-topic']).toBe('orders:placed');
  });
});

describe('OutboundServiceBusContextConverter', () => {
  function outboundContext(topic: string, request: unknown, headers: Record<string, string>): OutboundContext {
    return new OutboundContext(topic, request, headers);
  }

  it('serializes the message as the body and sets the topic + headers as applicationProperties', async () => {
    const converter = new OutboundServiceBusContextConverter();
    const context = await converter.createRequestAsync(
      outboundContext('orders:placed', { id: 42, name: 'foo' }, { tenantId: 'tenant-1' }),
    );

    expect(context).toBeInstanceOf(ServiceBusSendMessageContext);
    expect(context.message.applicationProperties!['topic']).toBe('orders:placed');
    expect(context.message.applicationProperties!['tenantId']).toBe('tenant-1');
    expect(context.message.body as string).toContain('foo');
  });

  it('maps the response to an accepted result', async () => {
    const converter = new OutboundServiceBusContextConverter();
    const contextIn = outboundContext('orders:placed', { id: 42 }, {});
    const contextOut = await converter.createRequestAsync(contextIn);

    await converter.mapResponseAsync(contextIn, contextOut);

    expect((contextIn.response as { isSuccessful: boolean }).isSuccessful).toBe(true);
  });
});
