import { describe, expect, it } from 'vitest';
import { VoidResult } from '@benzene/abstractions';
import {
  addOutboundRouting,
  IBenzeneMessageSender,
  OutboundResponseTypeMismatchException,
  UnroutedTopicException,
} from '@benzene/clients';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import { OutboundRoutingBuilder } from '@benzene/clients';

/**
 * Port of test/Benzene.Core.Test/Clients/DefaultBenzeneMessageSenderTest.cs. `DefaultBenzeneMessageSender`
 * is exercised through its public surface: `addOutboundRouting` -> resolved `IBenzeneMessageSender`.
 */

function senderFor(configure: (routing: OutboundRoutingBuilder) => void): IBenzeneMessageSender {
  const container = new DefaultBenzeneServiceContainer();
  addOutboundRouting(container, configure);
  return container.createServiceResolverFactory().createScope().getService(IBenzeneMessageSender);
}

describe('DefaultBenzeneMessageSender (via addOutboundRouting)', () => {
  it('a routed topic runs that topic pipeline and returns its response', async () => {
    const sender = senderFor((routing) =>
      routing.route('order:create', (pipeline) =>
        pipeline.onRequest((context) => {
          context.response = BenzeneResult.ok('created');
        }),
      ),
    );

    const result = await sender.sendAsync<string, string>('order:create', 'payload');

    expect(result.payload).toBe('created');
  });

  it('two routed topics each run their own pipeline', async () => {
    const sender = senderFor((routing) =>
      routing
        .route('order:create', (pipeline) =>
          pipeline.onRequest((context) => {
            context.response = BenzeneResult.ok('order-result');
          }),
        )
        .route('audit:log', (pipeline) =>
          pipeline.onRequest((context) => {
            context.response = BenzeneResult.ok('audit-result');
          }),
        ),
    );

    expect((await sender.sendAsync<string, string>('order:create', 'payload')).payload).toBe('order-result');
    expect((await sender.sendAsync<string, string>('audit:log', 'payload')).payload).toBe('audit-result');
  });

  it('an unrouted topic throws UnroutedTopicException naming the topic', async () => {
    const sender = senderFor((routing) => routing.route('order:create', (pipeline) => pipeline.onRequest(() => {})));

    await expect(sender.sendAsync<string, string>('unknown:topic', 'payload')).rejects.toSatisfy(
      (error) => error instanceof UnroutedTopicException && error.topic === 'unknown:topic',
    );
  });

  it('a route that sets no response throws OutboundResponseTypeMismatchException', async () => {
    // Erasure divergence: the .NET test asserts a Void-vs-TResponse generic mismatch, which the port
    // can't detect. The coarser case it can detect - a route producing no IBenzeneResult - is asserted.
    const sender = senderFor((routing) => routing.route('order:create', (pipeline) => pipeline.onRequest(() => {})));

    await expect(sender.sendAsync<string, string>('order:create', 'payload')).rejects.toSatisfy(
      (error) => error instanceof OutboundResponseTypeMismatchException && error.topic === 'order:create',
    );
  });

  it('a route that sets a Void response returns successfully', async () => {
    const sender = senderFor((routing) =>
      routing.route('order:create', (pipeline) =>
        pipeline.onRequest((context) => {
          context.response = BenzeneResult.accepted();
        }),
      ),
    );

    const result = await sender.sendAsync<string, VoidResult>('order:create', 'payload');

    expect(result.status).toBe(BenzeneResultStatus.accepted);
  });
});
