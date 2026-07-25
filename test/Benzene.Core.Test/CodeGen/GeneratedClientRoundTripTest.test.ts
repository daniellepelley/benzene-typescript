/**
 * The multi-language loop, closed end-to-end (mesh.md §2 → typed client):
 *   1. `examples/mesh-service` builds its normative ServiceDescriptor from its running handler registry
 *      (the same JSON a C# or Go service serves). `@benzene/codegen-client` generates a TypeScript client
 *      from it. This test regenerates that client and asserts it matches the committed
 *      `generated/OrdersServiceClient.ts` byte-for-byte — so the checked-in client (which `tsc --noEmit`
 *      compiles) is exactly what the generator produces, and the two can't drift.
 *   2. The committed client is instantiated over a fake `IBenzeneMessageSender` and its typed method is
 *      shown to send on the right topic and return the typed payload — proving the generated types line
 *      up with the runtime client surface.
 *
 * Nothing here knows the descriptor came from a TypeScript service; a C# service's descriptor generates
 * an identical client, which is the whole point of driving codegen from JSON Schema rather than reflection.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IBenzeneMessageSender } from '@benzene/clients';
import { BenzeneResult } from '@benzene/results';
import { buildDescriptor, registry } from '@benzene-example/mesh-service';
import { generateBenzeneClientSource } from '@benzene/codegen-client';
import { CreateOrderResponse, OrdersServiceClient } from './generated/OrdersServiceClient';

/** Captures the last send and returns a caller-supplied typed result - the port of a mocked sender. */
class FakeSender implements IBenzeneMessageSender {
  lastTopic: string | undefined;
  lastRequest: unknown;
  lastHeaders: Record<string, string> | undefined;

  constructor(private readonly response: unknown) {}

  sendAsync<TRequest, TResponse>(
    topic: string,
    request: TRequest,
    headers?: Record<string, string>,
  ): Promise<IBenzeneResultOf<TResponse>> {
    this.lastTopic = topic;
    this.lastRequest = request;
    this.lastHeaders = headers;
    return Promise.resolve(BenzeneResult.ok(this.response) as IBenzeneResultOf<TResponse>);
  }
}

describe('generated client round-trip', () => {
  it('the committed client is exactly what the generator produces from the example descriptor', () => {
    const regenerated = generateBenzeneClientSource(buildDescriptor(registry));
    const committed = readFileSync(
      fileURLToPath(new URL('./generated/OrdersServiceClient.ts', import.meta.url)),
      'utf8',
    );

    expect(regenerated).toBe(committed);
  });

  it('the generated client sends on the topic and returns the typed payload', async () => {
    const responsePayload: CreateOrderResponse = { orderId: 'order-acme' };
    const sender = new FakeSender(responsePayload);
    const client = new OrdersServiceClient(sender);

    const result = await client.createOrderAsync({ customerId: 'acme' }, { 'x-correlation-id': 'corr-1' });

    expect(sender.lastTopic).toBe('order:create');
    expect(sender.lastRequest).toEqual({ customerId: 'acme' });
    expect(sender.lastHeaders).toEqual({ 'x-correlation-id': 'corr-1' });
    // The payload is typed as CreateOrderResponse (compile-time) and carries the value (runtime).
    expect(result.payload.orderId).toBe('order-acme');
  });
});
