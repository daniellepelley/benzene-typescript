import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, VoidResult } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { addOutboundRouting, IBenzeneMessageSender, OutboundRoutingBuilder } from '@benzene/clients';
import {
  addInProcessMessaging,
  DuplicateInProcessPipelineException,
  InProcessDispatcherRegistry,
  InProcessMessagingAlreadyRegisteredException,
  InProcessPipelineNotFoundException,
  useInProcess,
} from '@benzene/clients-in-process';
import { message, MessageHandlersRegistry, useMessageHandlers } from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';

/**
 * Port of test/Benzene.Core.Test/Clients/InProcess/InProcessNamedPipelinesTest.cs. Coverage for named
 * in-process pipelines: several modules registered within one `addInProcessMessaging(...)` call,
 * routed independently via `useInProcess(app, name)`, and the safety nets around getting a name
 * wrong - a second top-level call, a duplicate name within one call, a route naming a pipeline
 * nothing registered.
 *
 * Assertions check dispatch via a side-effect (a shared `calls` array), not `result.payload`: this
 * port's in-process route is Void-only (see `InProcessContextConverter`'s PORT DIVERGENCE note), so
 * a handler's real return value never round-trips to the caller here the way it does in .NET.
 */

// A private registry so decorating these handlers does not leak into MessageHandlersRegistry.global
// used by other test files - matching UseMessageHandlersListFormsTest.test.ts's own convention.
const registry = new MessageHandlersRegistry();
let calls: string[] = [];

@message('billing:echo', { registry })
class EchoHandler implements IMessageHandler<string, string> {
  handleAsync(request: string): Promise<IBenzeneResultOf<string>> {
    calls.push(`billing:${request}`);
    return Promise.resolve(BenzeneResult.ok(`echo:${request}`));
  }
}

@message('shipping:shout', { registry })
class ShoutHandler implements IMessageHandler<string, string> {
  handleAsync(request: string): Promise<IBenzeneResultOf<string>> {
    calls.push(`shipping:${request}`);
    return Promise.resolve(BenzeneResult.ok(`${request.toUpperCase()}!`));
  }
}

function senderFor(
  configure: (routing: OutboundRoutingBuilder) => void,
  container: DefaultBenzeneServiceContainer = new DefaultBenzeneServiceContainer(),
): IBenzeneMessageSender {
  addOutboundRouting(container, configure);
  return container.createServiceResolverFactory().createScope().getService(IBenzeneMessageSender);
}

describe('addInProcessMessaging / useInProcess (named pipelines)', () => {
  it('two named pipelines in one call - each route dispatches to its own pipeline', async () => {
    calls = [];
    const container = new DefaultBenzeneServiceContainer();
    addInProcessMessaging(container, (registryBuilder) =>
      registryBuilder
        .add('billing', (pipeline) => useMessageHandlers(pipeline, EchoHandler))
        .add('shipping', (pipeline) => useMessageHandlers(pipeline, ShoutHandler)),
    );

    const sender = senderFor(
      (routing) =>
        routing
          .route('billing:echo', (pipeline) => useInProcess(pipeline, 'billing'))
          .route('shipping:shout', (pipeline) => useInProcess(pipeline, 'shipping')),
      container,
    );

    const billingResult = await sender.sendAsync<string, VoidResult>('billing:echo', 'hello');
    const shippingResult = await sender.sendAsync<string, VoidResult>('shipping:shout', 'hello');

    expect(billingResult.status).toBe(BenzeneResultStatus.ok);
    expect(shippingResult.status).toBe(BenzeneResultStatus.ok);
    expect(calls).toEqual(['billing:hello', 'shipping:hello']);
  });

  it('a second top-level addInProcessMessaging call throws rather than silently shadowing the first', () => {
    const container = new DefaultBenzeneServiceContainer();
    addInProcessMessaging(container, (registryBuilder) => registryBuilder.add((p) => useMessageHandlers(p)));

    expect(() =>
      addInProcessMessaging(container, (registryBuilder) => registryBuilder.add((p) => useMessageHandlers(p))),
    ).toThrow(InProcessMessagingAlreadyRegisteredException);
  });

  it('the same name added twice within one call throws naming the duplicate', () => {
    const build = () =>
      addInProcessMessaging(new DefaultBenzeneServiceContainer(), (registryBuilder) =>
        registryBuilder
          .add('billing', (p) => useMessageHandlers(p))
          .add('billing', (p) => useMessageHandlers(p)),
      );

    expect(build).toThrow(DuplicateInProcessPipelineException);
    try {
      build();
      throw new Error('expected build() to throw');
    } catch (error) {
      expect((error as DuplicateInProcessPipelineException).pipelineName).toBe('billing');
    }
  });

  it('resolve of an unregistered name throws listing the names that are registered', () => {
    const registry = new InProcessDispatcherRegistry(new Map());

    expect(() => registry.resolve('billing')).toThrow(InProcessPipelineNotFoundException);
    try {
      registry.resolve('billing');
      throw new Error('expected resolve() to throw');
    } catch (error) {
      expect((error as InProcessPipelineNotFoundException).pipelineName).toBe('billing');
      expect((error as InProcessPipelineNotFoundException).message).toContain('never called');
    }
  });

  it('a route naming a pipeline nothing registered throws InProcessPipelineNotFoundException at first send', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addInProcessMessaging(container, (registryBuilder) => registryBuilder.add('billing', (p) => useMessageHandlers(p)));

    // "shipping" is routed to but never registered - a typo, or a forgotten registration. This port
    // has no boot-time check (see index.ts's PORT DIVERGENCE note), so this is the only diagnostic.
    const sender = senderFor(
      (routing) => routing.route('shipping:charge', (pipeline) => useInProcess(pipeline, 'shipping')),
      container,
    );

    await expect(sender.sendAsync<string, VoidResult>('shipping:charge', 'hello')).rejects.toSatisfy(
      (error) => error instanceof InProcessPipelineNotFoundException && error.pipelineName === 'shipping',
    );
  });

  it('the parameterless single-pipeline form registers under DefaultName and routes with no name', async () => {
    calls = [];
    const solo = new MessageHandlersRegistry();

    @message('order:echo', { registry: solo })
    class SoloEchoHandler implements IMessageHandler<string, string> {
      handleAsync(request: string): Promise<IBenzeneResultOf<string>> {
        calls.push(`solo:${request}`);
        return Promise.resolve(BenzeneResult.ok(`solo:${request}`));
      }
    }

    const container = new DefaultBenzeneServiceContainer();
    addInProcessMessaging(container, (registryBuilder) =>
      registryBuilder.add((pipeline) => useMessageHandlers(pipeline, SoloEchoHandler)),
    );

    const sender = senderFor(
      (routing) => routing.route('order:echo', (pipeline) => useInProcess(pipeline)),
      container,
    );

    const result = await sender.sendAsync<string, VoidResult>('order:echo', 'hi');

    expect(result.status).toBe(BenzeneResultStatus.ok);
    expect(calls).toEqual(['solo:hi']);
  });

  it('an unhandled topic on a registered pipeline degrades to an honest NotFound', async () => {
    const container = new DefaultBenzeneServiceContainer();
    // No handler registered for "billing:missing" - useMessageHandlers(p) with no handler types,
    // matching .NET's UseMessageHandlers() parameterless call.
    addInProcessMessaging(container, (registryBuilder) => registryBuilder.add('billing', (p) => useMessageHandlers(p)));

    const sender = senderFor(
      (routing) => routing.route('billing:missing', (pipeline) => useInProcess(pipeline, 'billing')),
      container,
    );

    const result = await sender.sendAsync<string, VoidResult>('billing:missing', 'hello');

    expect(result.status).toBe(BenzeneResultStatus.notFound);
  });
});
