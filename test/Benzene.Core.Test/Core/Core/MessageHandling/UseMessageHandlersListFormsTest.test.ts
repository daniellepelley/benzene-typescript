import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IServiceResolverFactory } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { BenzeneMessageContext, BenzeneMessageRequest } from '@benzene/core-messages';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import {
  addBenzene,
  addBenzeneMessage,
  BenzeneMessageApplication,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';

/**
 * `useMessageHandlers` accepts handler classes as varargs OR as a single array (or a mix), so a module
 * can export its handler set once and wire it with one binding. All forms flatten to the same discovery
 * list; these prove each routes end-to-end through a real `BenzeneMessageApplication`.
 */

class Order {
  orderId: string | undefined;
}
class OrderCreated {
  reference: string | undefined;
}
class Cancel {
  orderId: string | undefined;
}
class Cancelled {
  reference: string | undefined;
}

// A private registry so decorating these handlers does not leak into the global registry used by other
// tests; passing the classes explicitly to `useMessageHandlers` reads their `@message` metadata directly.
const registry = new MessageHandlersRegistry();

@message('create-order', { registry, requestType: Order, responseType: OrderCreated })
class CreateOrderHandler implements IMessageHandler<Order, OrderCreated> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderCreated>> {
    const payload = new OrderCreated();
    payload.reference = `ref-${request.orderId}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

@message('cancel-order', { registry, requestType: Cancel, responseType: Cancelled })
class CancelOrderHandler implements IMessageHandler<Cancel, Cancelled> {
  handleAsync(request: Cancel): Promise<IBenzeneResultOf<Cancelled>> {
    const payload = new Cancelled();
    payload.reference = `cancelled-${request.orderId}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

// The "export your handler set once" pattern the array form is for.
const orderHandlers = [CreateOrderHandler, CancelOrderHandler] as const;

function appWith(
  configure: (builder: MiddlewarePipelineBuilder<BenzeneMessageContext>) => void,
): { app: BenzeneMessageApplication; resolverFactory: IServiceResolverFactory } {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addBenzeneMessage(container);

  const builder = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
  configure(builder);

  return { app: new BenzeneMessageApplication(builder.build()), resolverFactory: container.createServiceResolverFactory() };
}

function route(
  app: BenzeneMessageApplication,
  resolverFactory: IServiceResolverFactory,
  topic: string,
  body: unknown,
) {
  const request = new BenzeneMessageRequest();
  request.topic = topic;
  request.headers = {};
  request.body = JSON.stringify(body);
  return app.handleAsync(request, resolverFactory);
}

describe('useMessageHandlers handler-list forms', () => {
  it('routes handlers passed as a single array', async () => {
    const { app, resolverFactory } = appWith((builder) => useMessageHandlers(builder, orderHandlers));

    const created = await route(app, resolverFactory, 'create-order', { orderId: '42' });
    const cancelled = await route(app, resolverFactory, 'cancel-order', { orderId: '42' });

    expect(created.statusCode).toBe(BenzeneResultStatus.ok);
    expect(JSON.parse(created.body)).toEqual({ reference: 'ref-42' });
    expect(cancelled.statusCode).toBe(BenzeneResultStatus.ok);
    expect(JSON.parse(cancelled.body)).toEqual({ reference: 'cancelled-42' });
  });

  it('routes handlers passed as varargs (unchanged behavior)', async () => {
    const { app, resolverFactory } = appWith((builder) =>
      useMessageHandlers(builder, CreateOrderHandler, CancelOrderHandler),
    );

    const created = await route(app, resolverFactory, 'create-order', { orderId: '7' });

    expect(JSON.parse(created.body)).toEqual({ reference: 'ref-7' });
  });

  it('accepts a mix of single classes and arrays', async () => {
    const { app, resolverFactory } = appWith((builder) =>
      useMessageHandlers(builder, CreateOrderHandler, [CancelOrderHandler]),
    );

    const cancelled = await route(app, resolverFactory, 'cancel-order', { orderId: '9' });

    expect(JSON.parse(cancelled.body)).toEqual({ reference: 'cancelled-9' });
  });
});
