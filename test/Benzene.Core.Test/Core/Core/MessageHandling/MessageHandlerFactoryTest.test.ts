import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { ArgumentException } from '@benzene/core';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import {
  DefaultStatuses,
  InlineRequestMapperThunk,
  MessageHandlerFactory,
  NullMessageHandlerWrapper,
  RegistryMessageHandlersFinder,
  message,
  MessageHandlersRegistry,
} from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';

/** Port of Benzene.Test.Core.Core.MessageHandling.MessageHandlerFactoryTest scenarios. */
class Order {
  orderId: string | undefined;
}

class OrderCreated {
  reference: string | undefined;
}

const registry = new MessageHandlersRegistry();

@message('create-order', { registry, requestType: Order, responseType: OrderCreated })
class CreateOrderHandler implements IMessageHandler<Order, OrderCreated> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderCreated>> {
    const payload = new OrderCreated();
    payload.reference = `ref-${request.orderId}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

function createFactory(register?: (container: DefaultBenzeneServiceContainer) => void) {
  const container = new DefaultBenzeneServiceContainer();
  container.addTransient(CreateOrderHandler);
  register?.(container);
  const resolver = container.createServiceResolverFactory().createScope();
  return new MessageHandlerFactory(resolver, new NullMessageHandlerWrapper(), undefined, new DefaultStatuses());
}

describe('MessageHandlerFactoryTest', () => {
  it('Create_ResolvesHandlerAndExecutesIt', async () => {
    const definition = new RegistryMessageHandlersFinder(registry).findDefinitions()[0];
    const factory = createFactory();

    const handler = factory.create(definition);
    const order = new Order();
    order.orderId = '42';

    const result = await handler.handlerAsync(new InlineRequestMapperThunk(order));

    expect(result.status).toBe(BenzeneResultStatus.ok);
    expect(result.isSuccessful).toBe(true);
    expect((result.payloadAsObject as OrderCreated).reference).toBe('ref-42');
  });

  it('Handler_ReturningUndefined_MapsToAccepted', async () => {
    const container = new DefaultBenzeneServiceContainer();
    class FireAndForgetHandler {
      handleAsync(): Promise<undefined> {
        return Promise.resolve(undefined);
      }
    }
    container.addTransient(FireAndForgetHandler);
    const resolver = container.createServiceResolverFactory().createScope();
    const factory = new MessageHandlerFactory(resolver, new NullMessageHandlerWrapper());

    const definition = new RegistryMessageHandlersFinder(
      message('fire-and-forget', { registry: new MessageHandlersRegistry() })(FireAndForgetHandler),
    ).findDefinitions()[0];

    const result = await factory.create(definition).handlerAsync(new InlineRequestMapperThunk({}));

    expect(result.status).toBe(BenzeneResultStatus.accepted);
    expect(result.isSuccessful).toBe(true);
  });

  it('Handler_Throwing_MapsToServiceUnavailable', async () => {
    const container = new DefaultBenzeneServiceContainer();
    class FailingHandler {
      handleAsync(): Promise<never> {
        throw new Error('boom');
      }
    }
    container.addTransient(FailingHandler);
    const resolver = container.createServiceResolverFactory().createScope();
    const factory = new MessageHandlerFactory(resolver, new NullMessageHandlerWrapper());

    const definition = new RegistryMessageHandlersFinder(
      message('failing', { registry: new MessageHandlersRegistry() })(FailingHandler),
    ).findDefinitions()[0];

    const result = await factory.create(definition).handlerAsync(new InlineRequestMapperThunk({}));

    expect(result.status).toBe(BenzeneResultStatus.serviceUnavailable);
    expect(result.isSuccessful).toBe(false);
    expect(result.errors).toEqual(['Message handler threw an exception', 'boom']);
  });

  it('Handler_ThrowingArgumentException_MapsToValidationError', async () => {
    const container = new DefaultBenzeneServiceContainer();
    class PickyHandler {
      handleAsync(): Promise<never> {
        throw new ArgumentException('orderId is required');
      }
    }
    container.addTransient(PickyHandler);
    const resolver = container.createServiceResolverFactory().createScope();
    const factory = new MessageHandlerFactory(resolver, new NullMessageHandlerWrapper());

    const definition = new RegistryMessageHandlersFinder(
      message('picky', { registry: new MessageHandlersRegistry() })(PickyHandler),
    ).findDefinitions()[0];

    const result = await factory.create(definition).handlerAsync(new InlineRequestMapperThunk({}));

    expect(result.status).toBe(BenzeneResultStatus.validationError);
    expect(result.errors).toEqual(['orderId is required']);
  });

  it('Thunk_Throwing_MapsToBadRequest', async () => {
    const definition = new RegistryMessageHandlersFinder(registry).findDefinitions()[0];
    const factory = createFactory();

    const throwingThunk = {
      getRequest<T>(): T {
        throw new Error('malformed body');
      },
    };

    const result = await factory.create(definition).handlerAsync(throwingThunk);

    expect(result.status).toBe(BenzeneResultStatus.badRequest);
    expect(result.errors).toEqual(['Message is not valid', 'malformed body']);
  });
});
