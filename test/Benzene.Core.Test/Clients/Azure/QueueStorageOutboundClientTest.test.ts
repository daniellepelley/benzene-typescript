import { describe, expect, it } from 'vitest';
import type { QueueClient } from '@azure/storage-queue';
import { addOutboundRouting, IBenzeneMessageSender, OutboundContext } from '@benzenejs/clients';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import {
  OutboundQueueStorageContextConverter,
  QueueStorageSendMessageContext,
  useQueueStorage,
} from '@benzenejs/clients-azure-queue-storage';

/**
 * Port of the C# Benzene.Clients.Azure.QueueStorage tests (the OutboundContext send path — the generic
 * `QueueStorageContextConverter<T>`/`QueueStorageBenzeneMessageClient` are deferred, matching the
 * `@benzenejs/clients-*` siblings). Queue Storage has no per-message properties, so the topic/headers/body
 * are packed into a serialized `BenzeneMessageRequest` envelope that is the queue message text.
 */

function capturingQueueClient(): { sent: string[]; queueClient: QueueClient } {
  const sent: string[] = [];
  const queueClient = {
    sendMessage: (messageText: string) => {
      sent.push(messageText);
      return Promise.resolve({});
    },
  } as unknown as QueueClient;
  return { sent, queueClient };
}

function senderFor(
  configure: (routing: Parameters<Parameters<typeof addOutboundRouting>[1]>[0]) => void,
): IBenzeneMessageSender {
  const container = new DefaultBenzeneServiceContainer();
  addOutboundRouting(container, configure);
  return container.createServiceResolverFactory().createScope().getService(IBenzeneMessageSender);
}

describe('outbound Queue Storage client', () => {
  it('sends a BenzeneMessageRequest envelope carrying the topic, headers, and serialized body', async () => {
    const { sent, queueClient } = capturingQueueClient();
    const sender = senderFor((routing) =>
      routing.route('jobs:enqueue', (p) => useQueueStorage(p, queueClient)),
    );

    const result = await sender.sendAsync('jobs:enqueue', { jobId: 'j1' }, { tenant: 'acme' });

    expect(result.isSuccessful).toBe(true);
    expect(sent).toHaveLength(1);
    const envelope = JSON.parse(sent[0]!) as { topic: string; headers: Record<string, string>; body: string };
    expect(envelope.topic).toBe('jobs:enqueue');
    expect(envelope.headers['tenant']).toBe('acme');
    expect(JSON.parse(envelope.body)).toEqual({ jobId: 'j1' });
  });
});

describe('OutboundQueueStorageContextConverter', () => {
  function outboundContext(topic: string, request: unknown, headers: Record<string, string>): OutboundContext {
    return new OutboundContext(topic, request, headers);
  }

  it('packs the message into a serialized BenzeneMessageRequest envelope', async () => {
    const converter = new OutboundQueueStorageContextConverter();
    const context = await converter.createRequestAsync(
      outboundContext('jobs:enqueue', { id: 42, name: 'foo' }, { tenantId: 'tenant-1' }),
    );

    expect(context).toBeInstanceOf(QueueStorageSendMessageContext);
    const envelope = JSON.parse(context.messageText) as { topic: string; headers: Record<string, string>; body: string };
    expect(envelope.topic).toBe('jobs:enqueue');
    expect(envelope.headers['tenantId']).toBe('tenant-1');
    expect(envelope.body).toContain('foo');
  });

  it('maps the response to an accepted result', async () => {
    const converter = new OutboundQueueStorageContextConverter();
    const contextIn = outboundContext('jobs:enqueue', { id: 42 }, {});
    const contextOut = await converter.createRequestAsync(contextIn);

    await converter.mapResponseAsync(contextIn, contextOut);

    expect((contextIn.response as { isSuccessful: boolean }).isSuccessful).toBe(true);
  });
});
