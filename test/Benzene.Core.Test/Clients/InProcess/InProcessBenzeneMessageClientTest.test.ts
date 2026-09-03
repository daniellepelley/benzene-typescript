import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { IBenzeneMessageClient } from '@benzenejs/clients';
import {
  addInProcessMessaging,
  InProcessBenzeneMessageClient,
  InProcessPipelineNotFoundException,
} from '@benzenejs/clients-in-process';
import { message, MessageHandlersRegistry, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { BenzeneResult, BenzeneResultStatus } from '@benzenejs/results';

/**
 * The standalone in-process `IBenzeneMessageClient` — the W3.12 typed-wiring remainder from the
 * archived typed-outbound-responses plan. Where InProcessNamedPipelinesTest drives the ROUTED path
 * (`sendAsync` via `useInProcess`), this drives the STANDALONE client surface over the same registered
 * pipelines and asserts the same typed round trip: a success carries the handler's real, deserialized
 * `TResponse`; a failure carries the RFC 9457 problem document's structured errors (via the shared
 * `asBenzeneResult` mechanism), not a payload-less shell.
 */

const registry = new MessageHandlersRegistry();

class PlaceOrder {
  customerId = '';
}
class OrderPlaced {
  id = '';
  customerId = '';
}

@message('orders:place', { registry, requestType: PlaceOrder, responseType: OrderPlaced })
class PlaceOrderHandler implements IMessageHandler<PlaceOrder, OrderPlaced> {
  handleAsync(request: PlaceOrder): Promise<IBenzeneResultOf<OrderPlaced>> {
    if (request.customerId === '') {
      return Promise.resolve(
        BenzeneResult.validationError<OrderPlaced>({
          message: 'customerId must not be empty',
          field: '/customerId',
          code: 'required',
        }),
      );
    }

    const placed = new OrderPlaced();
    placed.id = 'order-1';
    placed.customerId = request.customerId;
    return Promise.resolve(BenzeneResult.ok(placed));
  }
}

function clientFor(name?: string): IBenzeneMessageClient {
  const container = new DefaultBenzeneServiceContainer();
  addInProcessMessaging(container, (registryBuilder) =>
    registryBuilder.add('orders', (pipeline) => useMessageHandlers(pipeline, PlaceOrderHandler)),
  );
  const resolver = container.createServiceResolverFactory().createScope();
  return InProcessBenzeneMessageClient.create(resolver, name ?? 'orders');
}

describe('InProcessBenzeneMessageClient', () => {
  it('returns the handler\'s real, typed response on success', async () => {
    const client = clientFor();

    const result = await client.sendMessageAsync<PlaceOrder, OrderPlaced>({
      topic: 'orders:place',
      message: { customerId: 'c-42' },
      headers: {},
    });

    expect(result.status).toBe(BenzeneResultStatus.ok);
    expect(result.isSuccessful).toBe(true);
    expect(result.payload.id).toBe('order-1');
    expect(result.payload.customerId).toBe('c-42');
  });

  it('surfaces a failure\'s structured errors from the problem document body', async () => {
    const client = clientFor();

    const result = await client.sendMessageAsync<PlaceOrder, OrderPlaced>({
      topic: 'orders:place',
      message: { customerId: '' },
      headers: {},
    });

    expect(result.status).toBe(BenzeneResultStatus.validationError);
    expect(result.isSuccessful).toBe(false);
    // The pipeline's failure body is an RFC 9457 problem document; asBenzeneResult recovers the
    // structured errors — field, code and all — instead of returning a payload-less shell.
    expect(result.errors).toEqual([
      { message: 'customerId must not be empty', field: '/customerId', code: 'required' },
    ]);
  });

  it('routes an unhandled topic to the pipeline\'s not-found result, not an exception', async () => {
    const client = clientFor();

    const result = await client.sendMessageAsync<PlaceOrder, OrderPlaced>({
      topic: 'orders:unknown',
      message: { customerId: 'c-42' },
      headers: {},
    });

    expect(result.isSuccessful).toBe(false);
  });

  it('fails fast at create() for a pipeline name nothing registered', () => {
    expect(() => clientFor('billing')).toThrow(InProcessPipelineNotFoundException);
  });
});
