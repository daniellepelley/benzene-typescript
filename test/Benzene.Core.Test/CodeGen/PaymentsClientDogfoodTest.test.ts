/**
 * Dogfoods `@benzenejs/codegen-client`'s Contract Document input path (contract-document.md) end-to-end
 * against a real, unedited `.spec.json` build artifact copied verbatim from the .NET port
 * (`benzene-dotnet/examples/AwsMesh/Orders/contracts/payments.spec.json`,
 * `@benzene-example/payments-client`'s `contracts/payments.spec.json`) - proving a Node consumer gets a
 * typed, topic-scoped client for a .NET service with no .NET SDK involved. Mirrors
 * `GeneratedClientRoundTripTest.test.ts`'s golden-file pattern for the mesh-descriptor input path,
 * applied here to the topic-scoped (`AtomicClientSdkBuilder`, contract-document.md §5.3) output shape.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import canonicalize from 'canonicalize';
import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IBenzeneMessageSender } from '@benzenejs/clients';
import { BenzeneResult } from '@benzenejs/results';
import {
  AtomicClientSdkOptions,
  buildAtomicClientSdk,
  parseContractDocument,
} from '@benzenejs/codegen-client';
import {
  addPaymentsClients,
  CapturePayment,
  PaymentDto,
  PaymentsCaptureServiceClient,
} from '@benzene-example/payments-client';

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

const contractPath = fileURLToPath(
  new URL('../../../examples/payments-client/contracts/payments.spec.json', import.meta.url),
);
const committedClientPath = fileURLToPath(
  new URL(
    '../../../examples/payments-client/src/generated/PaymentsCapture/PaymentsCaptureServiceClient.ts',
    import.meta.url,
  ),
);
const committedRegistrationPath = fileURLToPath(
  new URL('../../../examples/payments-client/src/generated/PaymentsClientsRegistration.ts', import.meta.url),
);

const options: AtomicClientSdkOptions = {
  serviceName: 'Payments',
  namespace: 'generated',
  topics: ['payments:capture'],
};

/**
 * An independent oracle for `payments:capture`'s topic-scoped `contractHash` (contract-document.md
 * §5.3, §6.2): hand-built from the source document rather than computed through
 * `@benzenejs/codegen-client`'s own `computeContractHash`, so this test doesn't just check the
 * implementation agrees with itself. `payments.spec.json`'s `payments:capture` entry reaches exactly
 * `CapturePayment`/`PaymentDto` (both flat objects, no nested `$ref`) - already normalize()'s no-op
 * shape (no `example`/`messageEndpoint`/`transports`/`reserved`), matching how
 * `contract-hash-cases.json`'s own `topicScoped` case is expressed.
 */
function independentlyComputedTopicScopedHash(): string {
  const document = parseContractDocument(readFileSync(contractPath, 'utf8'));
  const request = document.requests.find((r) => r.topic === 'payments:capture')!;

  const projected = {
    openapi: document.openapi,
    info: document.info,
    requests: [
      {
        topic: request.topic,
        httpMappings: request.httpMappings,
        request: request.request,
        response: request.response,
      },
    ],
    events: [],
    components: { schemas: { CapturePayment: document.components.schemas['CapturePayment'], PaymentDto: document.components.schemas['PaymentDto'] } },
  };

  const canonical = canonicalize(projected)!;
  const digest = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return `sha256:${digest}`;
}

describe('PaymentsClientDogfoodTest', () => {
  it('the committed files are exactly what the generator produces from the committed .spec.json', () => {
    const document = parseContractDocument(readFileSync(contractPath, 'utf8'));
    const [regeneratedClient, regeneratedRegistration] = buildAtomicClientSdk(document, options);

    expect(regeneratedClient!.source).toBe(readFileSync(committedClientPath, 'utf8'));
    expect(regeneratedRegistration!.source).toBe(readFileSync(committedRegistrationPath, 'utf8'));
  });

  it('carries no benzene:* reserved topic anywhere in the generated output, even though the source document has one', () => {
    const document = parseContractDocument(readFileSync(contractPath, 'utf8'));
    expect(document.requests.some((r) => r.topic === 'benzene:spec')).toBe(true); // sanity: the source document DOES have one

    const files = buildAtomicClientSdk(document, options);
    for (const file of files) {
      expect(file.source, file.fileName).not.toContain('benzene:');
    }
  });

  it("the generated client sends topic 'payments:capture' with the typed payload", async () => {
    const responsePayload: PaymentDto = { Id: 'pay_1', OrderId: 'order-acme', Amount: 42.42, Currency: 'GBP', Status: 'captured' };
    const sender = new FakeSender(responsePayload);
    const client = new PaymentsCaptureServiceClient(sender);

    const request: CapturePayment = { OrderId: 'order-acme', Amount: 42.42, Currency: 'GBP' };
    const result = await client.capturePaymentsAsync(request, { 'x-correlation-id': 'corr-1' });

    expect(sender.lastTopic).toBe('payments:capture');
    expect(sender.lastRequest).toEqual(request);
    expect(sender.lastHeaders).toEqual({ 'x-correlation-id': 'corr-1' });
    expect(result.payload).toEqual(responsePayload);
  });

  it("the client's embedded contractHash equals the independently computed hash for payments:capture's topic-scoped projection", () => {
    expect(PaymentsCaptureServiceClient.contractHash).toBe(independentlyComputedTopicScopedHash());
    // Also pins the format contract-document.md §6.2 specifies.
    expect(PaymentsCaptureServiceClient.contractHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('the aggregate registration function registers the per-topic client', () => {
    class RecordingContainer {
      registered: unknown[] = [];
      addScoped(service: unknown, implementation: unknown): RecordingContainer {
        this.registered.push([service, implementation]);
        return this;
      }
    }

    const container = new RecordingContainer();
    const returned = addPaymentsClients(container as unknown as Parameters<typeof addPaymentsClients>[0]);

    expect(returned).toBe(container);
    expect(container.registered).toHaveLength(1);
    expect(container.registered[0]).toEqual(
      expect.arrayContaining([expect.anything(), PaymentsCaptureServiceClient]),
    );
  });
});
