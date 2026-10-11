/**
 * The multi-language loop, closed end-to-end (Contract Document → typed client):
 *   1. `examples/mesh-service` is started for real and its `GET /benzene/spec` Contract Document is read - the
 *      document it derives from its running handler registry, the same shape a C# or Go service serves and the
 *      same body it would register with a mesh collector (mesh.md §2). `@benzenejs/codegen-client` generates a
 *      TypeScript client from it. This test regenerates that client and asserts it matches the committed
 *      `generated/OrdersServiceClient.ts` byte-for-byte — so the checked-in client (which `tsc --noEmit`
 *      compiles) is exactly what the generator produces, and the two can't drift.
 *   2. The committed client is instantiated over a fake `IBenzeneMessageSender` and its typed method is
 *      shown to send on the right topic and return the typed payload — proving the generated types line
 *      up with the runtime client surface.
 *
 * Nothing here knows the document came from a TypeScript service; a C# service's document generates an
 * identical client, which is the whole point of driving codegen from the contract rather than reflection.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IBenzeneMessageSender } from '@benzenejs/clients';
import { BenzeneResult } from '@benzenejs/results';
import { startOrderService } from '@benzene-example/mesh-service';
import { generateMessageClientSource, parseContractDocument } from '@benzenejs/codegen-client';
import { OrderCreated, OrdersServiceClient } from './generated/OrdersServiceClient';

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

/** The live example service's Contract Document, as served at `GET /benzene/spec`. */
async function servedDocument(): Promise<string> {
  const service = await startOrderService();
  try {
    const response = await fetch(`${service.url}/benzene/spec`);
    expect(response.status).toBe(200);
    return await response.text();
  } finally {
    await service.close();
  }
}

describe('generated client round-trip', () => {
  it("the committed client is exactly what the generator produces from the example's served document", async () => {
    const document = parseContractDocument(await servedDocument());
    const regenerated = generateMessageClientSource(document, { serviceName: 'Orders', namespace: 'Orders' });
    const committed = readFileSync(
      fileURLToPath(new URL('./generated/OrdersServiceClient.ts', import.meta.url)),
      'utf8',
    );

    expect(regenerated).toBe(committed);
  });

  it('the generated client sends on the topic and returns the typed payload', async () => {
    const responsePayload: OrderCreated = { orderId: 'order-acme' };
    const sender = new FakeSender(responsePayload);
    const client = new OrdersServiceClient(sender);

    const result = await client.createOrderAsync({ customerId: 'acme' }, { 'x-correlation-id': 'corr-1' });

    expect(sender.lastTopic).toBe('order:create');
    expect(sender.lastRequest).toEqual({ customerId: 'acme' });
    expect(sender.lastHeaders).toEqual({ 'x-correlation-id': 'corr-1' });
    // The payload is typed as OrderCreated (compile-time) and carries the value (runtime).
    expect(result.payload.orderId).toBe('order-acme');
  });
});
