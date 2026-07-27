import { describe, expect, it } from 'vitest';
import type { PubSub } from '@google-cloud/pubsub';
import { addOutboundRouting, IBenzeneMessageSender, OutboundContext } from '@benzene/clients';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import {
  OutboundPubSubContextConverter,
  PubSubSendMessageContext,
  usePubSub,
} from '@benzene/clients-google-cloud-pubsub';

/**
 * Port of the C# Benzene.Clients.GoogleCloud.PubSub tests (the OutboundContext publish path). Drives the
 * publish end-to-end from `IBenzeneMessageSender.sendAsync` over a fake `PubSub` client whose
 * `topic(name).publishMessage(message)` captures the topic + message and returns a stub message id.
 */

interface PublishedMessage {
  topicName: string;
  data: unknown;
  attributes?: Record<string, string>;
}

function capturingPubSub(): { published: PublishedMessage[]; pubSub: PubSub } {
  const published: PublishedMessage[] = [];
  const pubSub = {
    topic: (topicName: string) => ({
      publishMessage: (message: { data: unknown; attributes?: Record<string, string> }) => {
        published.push({ topicName, data: message.data, attributes: message.attributes });
        return Promise.resolve('server-message-id');
      },
    }),
  } as unknown as PubSub;
  return { published, pubSub };
}

function senderFor(
  configure: (routing: Parameters<Parameters<typeof addOutboundRouting>[1]>[0]) => void,
): IBenzeneMessageSender {
  const container = new DefaultBenzeneServiceContainer();
  addOutboundRouting(container, configure);
  return container.createServiceResolverFactory().createScope().getService(IBenzeneMessageSender);
}

describe('outbound Pub/Sub client', () => {
  it('publishes the routed message with the body as data and topic + headers as attributes', async () => {
    const { published, pubSub } = capturingPubSub();
    const sender = senderFor((routing) =>
      routing.route('orders:placed', (p) => usePubSub(p, pubSub, 'projects/proj-1/topics/orders')),
    );

    const result = await sender.sendAsync('orders:placed', { orderId: 'o1' }, { tenant: 'acme' });

    expect(result.isSuccessful).toBe(true);
    expect(published).toHaveLength(1);
    const message = published[0]!;
    expect(message.topicName).toBe('projects/proj-1/topics/orders');
    expect(JSON.parse(Buffer.from(message.data as Uint8Array).toString('utf8'))).toEqual({ orderId: 'o1' });
    expect(message.attributes!['topic']).toBe('orders:placed');
    expect(message.attributes!['tenant']).toBe('acme');
  });

  it('resolves a bare topic id against GOOGLE_CLOUD_PROJECT', async () => {
    const original = process.env['GOOGLE_CLOUD_PROJECT'];
    process.env['GOOGLE_CLOUD_PROJECT'] = 'my-project';
    try {
      const { published, pubSub } = capturingPubSub();
      const sender = senderFor((routing) =>
        routing.route('orders:placed', (p) => usePubSub(p, pubSub, 'orders')),
      );

      await sender.sendAsync('orders:placed', { orderId: 'o2' });

      expect(published[0]!.topicName).toBe('projects/my-project/topics/orders');
    } finally {
      if (original === undefined) {
        delete process.env['GOOGLE_CLOUD_PROJECT'];
      } else {
        process.env['GOOGLE_CLOUD_PROJECT'] = original;
      }
    }
  });
});

describe('OutboundPubSubContextConverter', () => {
  function outboundContext(topic: string, request: unknown, headers: Record<string, string>): OutboundContext {
    return new OutboundContext(topic, request, headers);
  }

  it('serializes the request as data and writes the routing topic + headers as attributes', async () => {
    const converter = new OutboundPubSubContextConverter('projects/proj-1/topics/orders');
    const context = await converter.createRequestAsync(
      outboundContext('orders:placed', { id: 42, name: 'foo' }, { tenantId: 'tenant-1' }),
    );

    expect(context).toBeInstanceOf(PubSubSendMessageContext);
    expect(context.topicName).toBe('projects/proj-1/topics/orders');
    expect(context.message.attributes!['topic']).toBe('orders:placed');
    expect(context.message.attributes!['tenantId']).toBe('tenant-1');
    expect(Buffer.from(context.message.data as Uint8Array).toString('utf8')).toContain('foo');
  });

  it('maps the response to an accepted result', async () => {
    const converter = new OutboundPubSubContextConverter('projects/proj-1/topics/orders');
    const contextIn = outboundContext('orders:placed', { id: 42 }, {});
    const contextOut = await converter.createRequestAsync(contextIn);

    await converter.mapResponseAsync(contextIn, contextOut);

    expect((contextIn.response as { isSuccessful: boolean }).isSuccessful).toBe(true);
  });
});
