import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, ISerializer } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { BenzeneResult } from '@benzenejs/results';
import {
  addMessageHandlers,
  IDefaultStatuses,
  message,
  MessageHandlersRegistry,
} from '@benzenejs/core-message-handlers';

/**
 * Registering message handlers pulls in the `addBenzene` baseline on its own — the router and factory
 * `addMessageHandlers` registers depend on it (`IDefaultStatuses`, `ISerializer`, the service resolver,
 * core middleware), so ensuring it there removes the old footgun where a pipeline wired up cleanly and
 * then failed on the first message with `IDefaultStatuses` unresolvable from inside
 * `MessageHandlerFactory`. No caller — no transport, no hand-composed app — has to remember
 * `addBenzene` anymore. Ports the same fix made to C# `AddMessageHandlers`.
 */

class Order {
  orderId: string | undefined;
}
class OrderCreated {
  reference: string | undefined;
}

// A private registry so decorating this handler does not leak into the global registry other tests use.
const registry = new MessageHandlersRegistry();

@message('create-order', { registry, requestType: Order, responseType: OrderCreated })
class CreateOrderHandler implements IMessageHandler<Order, OrderCreated> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderCreated>> {
    const payload = new OrderCreated();
    payload.reference = `ref-${request.orderId}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

function baseline(container: DefaultBenzeneServiceContainer) {
  const scope = container.createServiceResolverFactory().createScope();
  return {
    defaultStatuses: scope.getService(IDefaultStatuses),
    serializer: scope.getService(ISerializer),
  };
}

describe('addMessageHandlers ensures the addBenzene baseline', () => {
  it('registers the baseline with no handlers, without an explicit addBenzene', () => {
    const container = new DefaultBenzeneServiceContainer();
    // Deliberately no addBenzene() — only handler registration.
    addMessageHandlers(container);

    const { defaultStatuses, serializer } = baseline(container);
    expect(defaultStatuses).toBeDefined();
    expect(serializer).toBeDefined();
  });

  it('registers the baseline with handler classes, without an explicit addBenzene', () => {
    const container = new DefaultBenzeneServiceContainer();
    addMessageHandlers(container, CreateOrderHandler);

    const { defaultStatuses, serializer } = baseline(container);
    expect(defaultStatuses).toBeDefined();
    expect(serializer).toBeDefined();
  });
});
