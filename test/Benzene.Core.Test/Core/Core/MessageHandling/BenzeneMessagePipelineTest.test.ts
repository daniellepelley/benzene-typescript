import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IServiceResolver, ServiceIdentifier } from '@benzenejs/abstractions';
import { IMessageHandler, IMessageVersionGetter } from '@benzenejs/abstractions-message-handlers';
import {
  BenzeneMessageContext,
  BenzeneMessageRequest,
  Constants as MessagesConstants,
} from '@benzenejs/core-messages';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { BenzeneResult, BenzeneResultStatus } from '@benzenejs/results';
import {
  addBenzene,
  addBenzeneMessage,
  BenzeneMessageApplication,
  BenzeneMessageGetter,
  HeaderMessageVersionGetter,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';

/** A minimal scope resolver offering only the IMessageVersionGetter the version join looks up. */
function resolverWithVersionGetter(): IServiceResolver {
  const versionGetter = new HeaderMessageVersionGetter<BenzeneMessageContext>({
    getHeaders: (context: BenzeneMessageContext) => context.benzeneMessageRequest.headers ?? {},
  });
  return {
    getService<T>(identifier: ServiceIdentifier<T>): T {
      throw new Error(`No service registered for ${String(identifier)}`);
    },
    tryGetService<T>(identifier: ServiceIdentifier<T>): T | undefined {
      return identifier === IMessageVersionGetter ? (versionGetter as unknown as T) : undefined;
    },
    getServices<T>(): T[] {
      return [];
    },
    dispose(): void {},
  };
}

/**
 * End-to-end port of Benzene.Test.Core.Core.BenzeneMessagePipelineTest
 * (test/Benzene.Core.Test/Core/Core/DirectMessagePipelineTest.cs): wire the whole stack via idiomatic
 * DI registration and round-trip a real BenzeneMessage through a decorated handler and back.
 */

class Order {
  orderId: string | undefined;
}

class OrderCreated {
  reference: string | undefined;
}

// A private registry so decorating this handler does not leak into the global registry used by other
// tests; passing the class explicitly to `useMessageHandlers` reads its `@message` metadata directly.
const registry = new MessageHandlersRegistry();

@message('create-order', { registry, requestType: Order, responseType: OrderCreated })
class CreateOrderHandler implements IMessageHandler<Order, OrderCreated> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderCreated>> {
    const payload = new OrderCreated();
    payload.reference = `ref-${request.orderId}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

function buildApplication(): { app: BenzeneMessageApplication; container: DefaultBenzeneServiceContainer } {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addBenzeneMessage(container);

  const builder = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
  useMessageHandlers(builder, CreateOrderHandler);

  return { app: new BenzeneMessageApplication(builder.build()), container };
}

function createRequest(topic: string, body: unknown): BenzeneMessageRequest {
  const request = new BenzeneMessageRequest();
  request.topic = topic;
  request.headers = { sender: 'some-sender' };
  request.body = JSON.stringify(body);
  return request;
}

describe('BenzeneMessagePipelineTest', () => {
  it('Send_RoutesToHandlerAndReturnsOkResponse', async () => {
    const { app, container } = buildApplication();

    const response = await app.handleAsync(
      createRequest('create-order', { orderId: '42' }),
      container.createServiceResolverFactory(),
    );

    expect(response).toBeDefined();
    expect(response.statusCode).toBe(BenzeneResultStatus.ok);
    // The body is the handler's serialized OrderCreated payload — a genuine round-trip.
    expect(JSON.parse(response.body)).toEqual({ reference: 'ref-42' });
  });

  it('Send_UnknownTopic_ReturnsNotFoundResponse', async () => {
    const { app, container } = buildApplication();

    const response = await app.handleAsync(
      createRequest('does-not-exist', { orderId: '42' }),
      container.createServiceResolverFactory(),
    );

    expect(response).toBeDefined();
    expect(response.statusCode).toBe(BenzeneResultStatus.notFound);
  });

  it('Send_MissingTopic_MapsToMissingSentinelAndReturnsNotFound', async () => {
    const { app, container } = buildApplication();

    const request = new BenzeneMessageRequest();
    // topic left unset -> BenzeneMessageGetter yields the <missing> sentinel topic, for which no
    // handler is registered, so routing reports NotFound.
    request.headers = {};
    request.body = JSON.stringify({ orderId: '42' });

    const response = await app.handleAsync(request, container.createServiceResolverFactory());

    expect(response.statusCode).toBe(BenzeneResultStatus.notFound);
  });
});

describe('BenzeneMessageGetter', () => {
  it('ExtractsBodyTopicAndHeaders', () => {
    const getter = new BenzeneMessageGetter();
    const request = new BenzeneMessageRequest();
    request.topic = 'some-topic';
    request.body = 'some-message';
    request.headers = { orderId: 'some-order', version: '2.0' };
    const context = new BenzeneMessageContext(request);

    expect(getter.getBody(context)).toBe('some-message');
    expect(getter.getTopic(context)?.id).toBe('some-topic');
    // Direct construction with no resolver: the raw topic carries no version (the version join is
    // the IMessageVersionGetter's job, resolved lazily from the scope — the .NET #98 shape; baking
    // the raw `version` header into the raw topic would defeat the configured header order).
    expect(getter.getTopic(context)?.version ?? '').toBe('');
    expect(getter.getHeaders(context)).toEqual({ orderId: 'some-order', version: '2.0' });
    expect(new TextDecoder().decode(getter.getBodyBytes(context))).toBe('some-message');
  });

  it('JoinsTheDeclaredVersionOntoTheTopic_WhenAVersionGetterIsResolvable', () => {
    // The DI-resolved shape (.NET #98): the getter lazily resolves IMessageVersionGetter from the
    // scope it was constructed with, so getTopic returns the version-joined topic every consumer
    // (router, diagnostics, validation) then shares.
    const getter = new BenzeneMessageGetter(resolverWithVersionGetter());
    const request = new BenzeneMessageRequest();
    request.topic = 'some-topic';
    request.headers = { 'benzene-version': 'V2' };
    const context = new BenzeneMessageContext(request);

    expect(getter.getTopic(context)?.id).toBe('some-topic');
    expect(getter.getTopic(context)?.version).toBe('V2');
  });

  it('EmptyRequest_YieldsMissingTopicAndEmptyBytes', () => {
    const getter = new BenzeneMessageGetter();
    const context = new BenzeneMessageContext(new BenzeneMessageRequest());

    expect(getter.getTopic(context)?.id).toBe(MessagesConstants.missing.id);
    expect(getter.getBodyBytes(context).length).toBe(0);
  });
});
