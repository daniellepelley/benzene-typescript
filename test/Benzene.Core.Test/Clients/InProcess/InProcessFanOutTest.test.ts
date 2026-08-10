import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, VoidResult } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { addOutboundRouting, IBenzeneMessageSender, OutboundRoutingBuilder } from '@benzene/clients';
import {
  addInProcessMessaging,
  DuplicateInProcessFanOutTargetException,
  InProcessFanOutTarget,
  InProcessPipelineNotFoundException,
  useInProcessFanOut,
} from '@benzene/clients-in-process';
import { message, MessageHandlersRegistry, useMessageHandlers } from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';

/**
 * Port of test/Benzene.Core.Test/Clients/InProcess/InProcessFanOutTest.cs. Coverage for
 * `useInProcessFanOut(...)`: one outbound send dispatched to several named in-process pipelines
 * concurrently, each under its own topic, each isolated from the others' failures.
 */

const registry = new MessageHandlersRegistry();
let calls: string[] = [];

@message('billing:order-created', { registry })
class BillingHandler implements IMessageHandler<string, string> {
  handleAsync(request: string): Promise<IBenzeneResultOf<string>> {
    calls.push('billing');
    return Promise.resolve(BenzeneResult.ok(request));
  }
}

@message('shipping:order-created', { registry })
class ShippingHandler implements IMessageHandler<string, string> {
  handleAsync(request: string): Promise<IBenzeneResultOf<string>> {
    calls.push('shipping');
    return Promise.resolve(BenzeneResult.ok(request));
  }
}

@message('broken:order-created', { registry })
class ThrowingHandler implements IMessageHandler<string, string> {
  handleAsync(): Promise<IBenzeneResultOf<string>> {
    throw new Error('boom');
  }
}

@message('failing:order-created', { registry })
class FailingHandler implements IMessageHandler<string, string> {
  handleAsync(): Promise<IBenzeneResultOf<string>> {
    return Promise.resolve(BenzeneResult.validationError('nope'));
  }
}

function senderFor(
  configure: (routing: OutboundRoutingBuilder) => void,
  container: DefaultBenzeneServiceContainer,
): IBenzeneMessageSender {
  addOutboundRouting(container, configure);
  return container.createServiceResolverFactory().createScope().getService(IBenzeneMessageSender);
}

describe('useInProcessFanOut', () => {
  it('dispatches to every target under its own topic', async () => {
    calls = [];
    const container = new DefaultBenzeneServiceContainer();
    addInProcessMessaging(container, (r) =>
      r
        .add('billing', (p) => useMessageHandlers(p, BillingHandler))
        .add('shipping', (p) => useMessageHandlers(p, ShippingHandler)),
    );

    const sender = senderFor(
      (routing) =>
        routing.route('order:created', (pipeline) =>
          useInProcessFanOut(
            pipeline,
            new InProcessFanOutTarget('billing', 'billing:order-created'),
            new InProcessFanOutTarget('shipping', 'shipping:order-created'),
          ),
        ),
      container,
    );

    const result = await sender.sendAsync<string, VoidResult>('order:created', 'hello');

    expect(result.status).toBe(BenzeneResultStatus.ok);
    expect(calls.sort()).toEqual(['billing', 'shipping']);
  });

  it('one consumer throws - the other still receives the message and the caller still succeeds', async () => {
    calls = [];
    const container = new DefaultBenzeneServiceContainer();
    addInProcessMessaging(container, (r) =>
      r
        .add('broken', (p) => useMessageHandlers(p, ThrowingHandler))
        .add('shipping', (p) => useMessageHandlers(p, ShippingHandler)),
    );

    const sender = senderFor(
      (routing) =>
        routing.route('order:created', (pipeline) =>
          useInProcessFanOut(
            pipeline,
            new InProcessFanOutTarget('broken', 'broken:order-created'),
            new InProcessFanOutTarget('shipping', 'shipping:order-created'),
          ),
        ),
      container,
    );

    const result = await sender.sendAsync<string, VoidResult>('order:created', 'hello');

    expect(result.status).toBe(BenzeneResultStatus.ok);
    expect(calls).toContain('shipping');
  });

  it('one consumer returns a failure status - does not affect the caller or the other consumer', async () => {
    calls = [];
    const container = new DefaultBenzeneServiceContainer();
    addInProcessMessaging(container, (r) =>
      r
        .add('failing', (p) => useMessageHandlers(p, FailingHandler))
        .add('shipping', (p) => useMessageHandlers(p, ShippingHandler)),
    );

    const sender = senderFor(
      (routing) =>
        routing.route('order:created', (pipeline) =>
          useInProcessFanOut(
            pipeline,
            new InProcessFanOutTarget('failing', 'failing:order-created'),
            new InProcessFanOutTarget('shipping', 'shipping:order-created'),
          ),
        ),
      container,
    );

    const result = await sender.sendAsync<string, VoidResult>('order:created', 'hello');

    expect(result.status).toBe(BenzeneResultStatus.ok);
    expect(calls).toContain('shipping');
  });

  it('useInProcessFanOut with no targets throws rather than building a useless route', () => {
    const container = new DefaultBenzeneServiceContainer();

    expect(() =>
      addOutboundRouting(container, (routing) =>
        routing.route('order:created', (pipeline) => useInProcessFanOut(pipeline)),
      ),
    ).toThrow('at least one target');
  });

  it('two targets sharing a topic throws rather than silently misrouting', () => {
    const build = () =>
      addOutboundRouting(new DefaultBenzeneServiceContainer(), (routing) =>
        routing.route('order:created', (pipeline) =>
          useInProcessFanOut(
            pipeline,
            new InProcessFanOutTarget('billing', 'order:created'),
            new InProcessFanOutTarget('shipping', 'order:created'),
          ),
        ),
      );

    expect(build).toThrow(DuplicateInProcessFanOutTargetException);
    try {
      build();
      throw new Error('expected build() to throw');
    } catch (error) {
      expect((error as DuplicateInProcessFanOutTargetException).topic).toBe('order:created');
    }
  });

  it("one target's pipeline is never registered - throws the same InProcessPipelineNotFoundException a single-target route would", async () => {
    const container = new DefaultBenzeneServiceContainer();
    addInProcessMessaging(container, (r) => r.add('billing', (p) => useMessageHandlers(p, BillingHandler)));

    // "shipping" is never registered.
    const sender = senderFor(
      (routing) =>
        routing.route('order:created', (pipeline) =>
          useInProcessFanOut(
            pipeline,
            new InProcessFanOutTarget('billing', 'billing:order-created'),
            new InProcessFanOutTarget('shipping', 'shipping:order-created'),
          ),
        ),
      container,
    );

    await expect(sender.sendAsync<string, VoidResult>('order:created', 'hello')).rejects.toSatisfy(
      (error) => error instanceof InProcessPipelineNotFoundException && error.pipelineName === 'shipping',
    );
  });
});
