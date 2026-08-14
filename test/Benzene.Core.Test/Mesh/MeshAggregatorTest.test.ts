import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HealthCheckResponse, HealthCheckResult } from '@benzenejs/health-checks-core';
import {
  FileSystemMeshArtifactStore,
  HttpMeshServiceSource,
  IMeshArtifactStore,
  IMeshServiceSource,
  MeshAggregator,
} from '@benzenejs/mesh-aggregator';
import {
  IMeshUsageSource,
  MeshManifest,
  MeshManifestEntry,
  MeshServiceRegistry,
  MeshServiceRegistryEntry,
  MeshServiceSource,
  MeshServiceStatus,
  MeshTopicChangeKind,
  MeshTopicStatus,
  MeshUsage,
  MeshUsageEntry,
  TopologyEdgeSource,
} from '@benzenejs/mesh-contracts';
import { BenzeneResultStatus } from '@benzenejs/results';

/**
 * Port of test/Benzene.Mesh.Test/MeshAggregatorTest.cs. The C# `RoutingHttpMessageHandler` + `HttpClient`
 * become a URL-routing stub `fetch`; `JsonSerializer.Deserialize<T>` of each published artifact becomes
 * `JSON.parse` typed loosely (the assertions read arbitrary JSON). `DateTimeOffset` -> epoch ms;
 * `nameof(HttpRequestException)` -> the port's `HttpRequestException.name`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const SpecUrl = 'https://orders-api.example/spec?type=benzene';
const HealthUrl = 'https://orders-api.example/healthcheck';

const minutes = (n: number): number => n * 60_000;
const hours = (n: number): number => n * 3_600_000;
const days = (n: number): number => n * 86_400_000;

function serializeHealth(isHealthy: boolean): string {
  const response = new HealthCheckResponse(isHealthy, { Simple: HealthCheckResult.createInstance(isHealthy, 'Simple') });
  return JSON.stringify(response);
}

function singleServiceRegistry(): MeshServiceRegistry {
  return new MeshServiceRegistry([new MeshServiceRegistryEntry('orders-api', SpecUrl, HealthUrl)]);
}

/** Port of the C# `RoutingHttpMessageHandler`: a stub `fetch` that answers configured URLs. */
function routingFetch(): {
  mapGet(url: string, status: number, content: string | undefined): ReturnType<typeof routingFetch>;
  fetchFn: typeof fetch;
} {
  const responses = new Map<string, { status: number; content: string | undefined }>();
  const fetchFn = ((url: string) => {
    const response = responses.get(url);
    if (response === undefined) {
      return Promise.reject(new Error(`No stubbed response configured for ${url}`));
    }
    return Promise.resolve(new Response(response.content ?? '', { status: response.status }));
  }) as unknown as typeof fetch;

  const api = {
    mapGet(url: string, status: number, content: string | undefined) {
      responses.set(url, { status, content });
      return api;
    },
    fetchFn,
  };
  return api;
}

class StubUsageSource implements IMeshUsageSource {
  constructor(private readonly reportOrError: MeshUsage | undefined | Error) {}

  fetchUsageAsync(_cancellationToken?: AbortSignal): Promise<MeshUsage | undefined> {
    return this.reportOrError instanceof Error ? Promise.reject(this.reportOrError) : Promise.resolve(this.reportOrError);
  }
}

class FakeMeshServiceSource implements IMeshServiceSource {
  wasCalled = false;
  readonly key = 'fake';

  constructor(
    private readonly specJson: string,
    private readonly healthJson: string,
  ) {}

  fetchSpecAsync(): Promise<string> {
    this.wasCalled = true;
    return Promise.resolve(this.specJson);
  }

  fetchHealthAsync(): Promise<string> {
    return Promise.resolve(this.healthJson);
  }
}

describe('MeshAggregator', () => {
  let rootDirectory: string;

  beforeEach(() => {
    rootDirectory = mkdtempSync(join(tmpdir(), 'benzene-mesh-aggregator-test-'));
  });

  afterEach(() => {
    rmSync(rootDirectory, { recursive: true, force: true });
  });

  function httpAggregator(
    handler: ReturnType<typeof routingFetch>,
    store: IMeshArtifactStore = new FileSystemMeshArtifactStore(rootDirectory),
    clock?: () => number,
    usageSources?: IMeshUsageSource[],
  ): MeshAggregator {
    return new MeshAggregator([new HttpMeshServiceSource(handler.fetchFn)], store, clock, usageSources);
  }

  it('RunOnceAsync_HealthyService_FirstRun_ReportsHealthyNoDrift', async () => {
    const handler = routingFetch()
      .mapGet(SpecUrl, 200, '{"info":{"title":"orders-api"}}')
      .mapGet(HealthUrl, 200, serializeHealth(true));
    const aggregator = httpAggregator(handler);

    const manifest = await aggregator.runOnceAsync(singleServiceRegistry());

    expect(manifest.services).toHaveLength(1);
    expect(manifest.services[0]!.status).toBe(MeshServiceStatus.healthy);
    expect(manifest.services[0]!.contractDrift).toBe(false);
  });

  it('RunOnceAsync_PopulatesSnapshotAtUtc_FromTheSnapshotFetchTime', async () => {
    const at = Date.UTC(2026, 6, 20, 9, 0, 0);
    const handler = routingFetch()
      .mapGet(SpecUrl, 200, '{"info":{"title":"orders-api"}}')
      .mapGet(HealthUrl, 200, serializeHealth(true));
    const aggregator = httpAggregator(handler, undefined, () => at);

    const manifest = await aggregator.runOnceAsync(singleServiceRegistry());

    expect(manifest.services[0]!.snapshotAtUtc).toBe(at);
  });

  it('RunOnceAsync_UnreachableService_StillCarriesSnapshotAtUtc', async () => {
    const at = Date.UTC(2026, 6, 20, 9, 0, 0);
    const handler = routingFetch().mapGet(SpecUrl, 500, undefined).mapGet(HealthUrl, 500, undefined);
    const aggregator = httpAggregator(handler, undefined, () => at);

    const manifest = await aggregator.runOnceAsync(singleServiceRegistry());

    expect(manifest.services[0]!.status).toBe(MeshServiceStatus.unreachable);
    expect(manifest.services[0]!.snapshotAtUtc).toBe(at);
  });

  it('MeshManifestEntry_SnapshotAtUtc_RoundTrips_AndIsBackwardCompatible', () => {
    const at = Date.UTC(2026, 6, 20, 9, 0, 0);
    const manifest = new MeshManifest(at, [
      new MeshManifestEntry('orders-api', MeshServiceStatus.healthy, false, SpecUrl, HealthUrl, undefined, [], at),
    ]);

    const round = JSON.parse(JSON.stringify(manifest)) as Json;
    expect(round.services[0].snapshotAtUtc).toBe(at);

    // An older manifest.json without the field parses with an undefined timestamp (back-compat).
    const legacy = '{"generatedAtUtc":1784970000000,"services":[{"name":"orders-api","status":"healthy","contractDrift":false,"specUrl":"s","healthUrl":"h"}]}';
    const legacyManifest = JSON.parse(legacy) as Json;
    expect(legacyManifest.services[0].snapshotAtUtc).toBeUndefined();
  });

  it('RunOnceAsync_PublishesTopicsCatalog_AcrossServices_WithReservedFlag', async () => {
    const paymentsSpecUrl = 'https://payments-api.example/spec?type=benzene';
    const paymentsHealthUrl = 'https://payments-api.example/healthcheck';
    const ordersSpec = '{"requests":[{"topic":"order:create","httpMappings":[{"method":"post","path":"/orders"}]},{"topic":"spec","reserved":true}]}';
    const paymentsSpec = '{"requests":[{"topic":"payment:take"},{"topic":"spec","reserved":true}]}';

    const handler = routingFetch()
      .mapGet(SpecUrl, 200, ordersSpec)
      .mapGet(HealthUrl, 200, serializeHealth(true))
      .mapGet(paymentsSpecUrl, 200, paymentsSpec)
      .mapGet(paymentsHealthUrl, 200, serializeHealth(true));
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const aggregator = httpAggregator(handler, store);

    await aggregator.runOnceAsync(
      new MeshServiceRegistry([
        new MeshServiceRegistryEntry('orders-api', SpecUrl, HealthUrl),
        new MeshServiceRegistryEntry('payments-api', paymentsSpecUrl, paymentsHealthUrl),
      ]),
    );

    const json = await store.tryReadAsync('topics.json');
    expect(json).not.toBeUndefined();
    const catalog = JSON.parse(json!) as Json;

    const spec = catalog.topics.filter((t: Json) => t.topic === 'spec');
    expect(spec).toHaveLength(1);
    expect(spec[0].reserved).toBe(true);
    expect(spec[0].status ?? undefined).toBeUndefined();
    expect(spec[0].consumers.map((s: Json) => s.service).sort()).toEqual(['orders-api', 'payments-api']);

    const create = catalog.topics.filter((t: Json) => t.topic === 'order:create');
    expect(create).toHaveLength(1);
    expect(create[0].reserved).toBe(false);
    expect(create[0].status ?? undefined).toBeUndefined();
    expect(create[0].consumers).toHaveLength(1);
    expect(create[0].consumers[0].service).toBe('orders-api');
    expect(create[0].consumers[0].httpMappings[0].method).toBe('post');
    expect(create[0].producers).toHaveLength(0);

    // Domain topics sort ahead of reserved utilities.
    expect(catalog.topics[0].reserved).toBe(false);
    expect(catalog.topics[catalog.topics.length - 1].reserved).toBe(true);
  });

  it('RunOnceAsync_ReconcilesVersions_AcrossProducersAndConsumers', async () => {
    const paymentsSpecUrl = 'https://payments-api.example/spec?type=benzene';
    const paymentsHealthUrl = 'https://payments-api.example/healthcheck';
    const ordersSpec = '{"requests":[{"topic":"order:create"}],"events":[{"topic":"payments:get","version":"1"}]}';
    const paymentsSpec = '{"requests":[{"topic":"payments:get","version":"2"}]}';

    const handler = routingFetch()
      .mapGet(SpecUrl, 200, ordersSpec)
      .mapGet(HealthUrl, 200, serializeHealth(true))
      .mapGet(paymentsSpecUrl, 200, paymentsSpec)
      .mapGet(paymentsHealthUrl, 200, serializeHealth(true));
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const aggregator = httpAggregator(handler, store);

    await aggregator.runOnceAsync(
      new MeshServiceRegistry([
        new MeshServiceRegistryEntry('orders-api', SpecUrl, HealthUrl),
        new MeshServiceRegistryEntry('payments-api', paymentsSpecUrl, paymentsHealthUrl),
      ]),
    );

    const catalog = JSON.parse((await store.tryReadAsync('topics.json'))!) as Json;

    const compat = catalog.versionCompatibility.filter((v: Json) => v.topic === 'payments:get');
    expect(compat).toHaveLength(1);
    expect(compat[0].producedVersions).toEqual(['1']);
    expect(compat[0].consumedVersions).toEqual(['2']);
    expect(compat[0].producedNotConsumed).toEqual(['1']);
    expect(compat[0].consumedNotProduced).toEqual(['2']);

    expect(catalog.versionCompatibility.some((v: Json) => v.topic === 'order:create')).toBe(false);
  });

  it('RunOnceAsync_PublishesCompositeAsyncApi_FromEachServicesAsyncApiEndpoint', async () => {
    const paymentsSpecUrl = 'https://payments-api.example/spec?type=benzene';
    const paymentsHealthUrl = 'https://payments-api.example/healthcheck';
    const ordersBenzene = '{"requests":[{"topic":"order:create"},{"topic":"spec","reserved":true}]}';
    const paymentsBenzene = '{"requests":[{"topic":"payment:take"},{"topic":"spec","reserved":true}]}';
    const ordersAsyncApi = asyncApiDoc('orders-api', 'order:create', 'Order');
    const paymentsAsyncApi = asyncApiDoc('payments-api', 'payment:take', 'Payment');

    const handler = routingFetch()
      .mapGet(SpecUrl, 200, ordersBenzene)
      .mapGet('https://orders-api.example/spec?type=asyncapi&format=json', 200, ordersAsyncApi)
      .mapGet(HealthUrl, 200, serializeHealth(true))
      .mapGet(paymentsSpecUrl, 200, paymentsBenzene)
      .mapGet('https://payments-api.example/spec?type=asyncapi&format=json', 200, paymentsAsyncApi)
      .mapGet(paymentsHealthUrl, 200, serializeHealth(true));
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const aggregator = httpAggregator(handler, store);

    await aggregator.runOnceAsync(
      new MeshServiceRegistry([
        new MeshServiceRegistryEntry('orders-api', SpecUrl, HealthUrl),
        new MeshServiceRegistryEntry('payments-api', paymentsSpecUrl, paymentsHealthUrl),
      ]),
    );

    const json = await store.tryReadAsync('asyncapi.json');
    expect(json).not.toBeUndefined();

    const parsed = JSON.parse(json!) as Json;
    expect(parsed.asyncapi).toBe('3.0.0');
    const channelKeys = Object.keys(parsed.channels as Json);
    expect(channelKeys).toContain('orders-api_order_create');
    expect(channelKeys).toContain('payments-api_payment_take');
    expect(channelKeys.some((k) => k.includes('spec'))).toBe(false);
    const operationKeys = Object.keys(parsed.operations as Json);
    expect(operationKeys).toContain('orders-api_order_create');
    expect(operationKeys).toContain('payments-api_payment_take');
  });

  it('RunOnceAsync_TopicWithSchema_InlinesRefsAndCarriesRequestResponseSchema', async () => {
    const ordersSpec =
      '{"requests":[{"topic":"order:create","request":{"$ref":"#/components/schemas/CreateOrder"},"response":{"$ref":"#/components/schemas/Order"}}],"components":{"schemas":{"CreateOrder":{"type":"object","required":["customerId"],"properties":{"customerId":{"type":"string","format":"uuid"},"line":{"$ref":"#/components/schemas/OrderLine"}}},"OrderLine":{"type":"object","properties":{"sku":{"type":"string","pattern":"^[A-Z]{3}$"}}},"Order":{"type":"object","properties":{"id":{"type":"string"}}}}}}';

    const handler = routingFetch().mapGet(SpecUrl, 200, ordersSpec).mapGet(HealthUrl, 200, serializeHealth(true));
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const aggregator = httpAggregator(handler, store);

    await aggregator.runOnceAsync(singleServiceRegistry());

    const catalog = JSON.parse((await store.tryReadAsync('topics.json'))!) as Json;
    const create = catalog.topics.find((t: Json) => t.topic === 'order:create');

    expect(create.schemaMismatch).toBe(false);
    expect(create.requestSchema).not.toBeUndefined();
    expect(create.responseSchema).not.toBeUndefined();

    // The top-level $ref was resolved and tagged with the ref name as a title.
    expect(create.requestSchema.title).toBe('CreateOrder');
    const props = create.requestSchema.properties;
    expect(props.customerId.format).toBe('uuid');

    // A nested $ref was inlined too.
    const line = props.line;
    expect(line.$ref).toBeUndefined();
    expect(line.title).toBe('OrderLine');
    expect(line.properties.sku.pattern).toBe('^[A-Z]{3}$');
  });

  it('RunOnceAsync_PolymorphicSchema_InlinesRefsInsideOneOfAndAllOfBranches', async () => {
    const ordersSpec =
      '{"requests":[{"topic":"order:pay","request":{"$ref":"#/components/schemas/PayOrder"}}],"components":{"schemas":{"PayOrder":{"type":"object","properties":{"payment":{"oneOf":[{"$ref":"#/components/schemas/CardPayment"},{"$ref":"#/components/schemas/BankPayment"}]}}},"CardPayment":{"type":"object","allOf":[{"$ref":"#/components/schemas/PaymentMethod"}],"properties":{"cardNumber":{"type":"string"}}},"BankPayment":{"type":"object","allOf":[{"$ref":"#/components/schemas/PaymentMethod"}],"properties":{"iban":{"type":"string"}}},"PaymentMethod":{"type":"object","properties":{"currency":{"type":"string"}}}}}}';

    const handler = routingFetch().mapGet(SpecUrl, 200, ordersSpec).mapGet(HealthUrl, 200, serializeHealth(true));
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const aggregator = httpAggregator(handler, store);

    await aggregator.runOnceAsync(singleServiceRegistry());

    const catalog = JSON.parse((await store.tryReadAsync('topics.json'))!) as Json;
    const pay = catalog.topics.find((t: Json) => t.topic === 'order:pay');

    const oneOf = pay.requestSchema.properties.payment.oneOf;
    expect(oneOf).toHaveLength(2);

    const card = oneOf[0];
    expect(card.$ref).toBeUndefined();
    expect(card.title).toBe('CardPayment');
    expect(card.properties.cardNumber.type).toBe('string');

    const cardBase = card.allOf[0];
    expect(cardBase.$ref).toBeUndefined();
    expect(cardBase.title).toBe('PaymentMethod');
    expect(cardBase.properties.currency.type).toBe('string');
  });

  it('RunOnceAsync_TwoConsumersSameTopicVersion_DifferentPayloads_FlagsSchemaMismatch', async () => {
    const paymentsSpecUrl = 'https://payments-api.example/spec?type=benzene';
    const paymentsHealthUrl = 'https://payments-api.example/healthcheck';
    const ordersSpec = '{"requests":[{"topic":"order:submitted","request":{"$ref":"#/components/schemas/S"}}],"components":{"schemas":{"S":{"type":"object","properties":{"id":{"type":"string"}}}}}}';
    const fulfilmentSpec = '{"requests":[{"topic":"order:submitted","request":{"$ref":"#/components/schemas/S"}}],"components":{"schemas":{"S":{"type":"object","properties":{"id":{"type":"string"},"warehouse":{"type":"string"}}}}}}';

    const handler = routingFetch()
      .mapGet(SpecUrl, 200, ordersSpec)
      .mapGet(HealthUrl, 200, serializeHealth(true))
      .mapGet(paymentsSpecUrl, 200, fulfilmentSpec)
      .mapGet(paymentsHealthUrl, 200, serializeHealth(true));
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const aggregator = httpAggregator(handler, store);

    await aggregator.runOnceAsync(
      new MeshServiceRegistry([
        new MeshServiceRegistryEntry('orders-api', SpecUrl, HealthUrl),
        new MeshServiceRegistryEntry('fulfilment-api', paymentsSpecUrl, paymentsHealthUrl),
      ]),
    );

    const catalog = JSON.parse((await store.tryReadAsync('topics.json'))!) as Json;
    const submitted = catalog.topics.find((t: Json) => t.topic === 'order:submitted');

    expect(submitted.consumers).toHaveLength(2);
    expect(submitted.schemaMismatch).toBe(true);
    expect(submitted.requestSchema).not.toBeUndefined();
  });

  it('RunOnceAsync_TwoConsumersSameTopicVersion_IdenticalPayloads_NoMismatch', async () => {
    const paymentsSpecUrl = 'https://payments-api.example/spec?type=benzene';
    const paymentsHealthUrl = 'https://payments-api.example/healthcheck';
    const ordersSpec = '{"requests":[{"topic":"order:submitted","request":{"$ref":"#/components/schemas/S"}}],"components":{"schemas":{"S":{"type":"object","properties":{"id":{"type":"string"},"total":{"type":"integer"}}}}}}';
    const fulfilmentSpec = '{"requests":[{"topic":"order:submitted","request":{"$ref":"#/components/schemas/S"}}],"components":{"schemas":{"S":{"properties":{"total":{"type":"integer"},"id":{"type":"string"}},"type":"object"}}}}';

    const handler = routingFetch()
      .mapGet(SpecUrl, 200, ordersSpec)
      .mapGet(HealthUrl, 200, serializeHealth(true))
      .mapGet(paymentsSpecUrl, 200, fulfilmentSpec)
      .mapGet(paymentsHealthUrl, 200, serializeHealth(true));
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const aggregator = httpAggregator(handler, store);

    await aggregator.runOnceAsync(
      new MeshServiceRegistry([
        new MeshServiceRegistryEntry('orders-api', SpecUrl, HealthUrl),
        new MeshServiceRegistryEntry('fulfilment-api', paymentsSpecUrl, paymentsHealthUrl),
      ]),
    );

    const catalog = JSON.parse((await store.tryReadAsync('topics.json'))!) as Json;
    const submitted = catalog.topics.find((t: Json) => t.topic === 'order:submitted');

    expect(submitted.consumers).toHaveLength(2);
    expect(submitted.schemaMismatch).toBe(false);
  });

  it('RunOnceAsync_SameRequest_OneConsumerDeclaresResponseOtherDoesnt_NoMismatch', async () => {
    const paymentsSpecUrl = 'https://payments-api.example/spec?type=benzene';
    const paymentsHealthUrl = 'https://payments-api.example/healthcheck';
    const ordersSpec = '{"requests":[{"topic":"order:submitted","request":{"$ref":"#/components/schemas/S"},"response":{"$ref":"#/components/schemas/R"}}],"components":{"schemas":{"S":{"type":"object","properties":{"id":{"type":"string"}}},"R":{"type":"object","properties":{"ok":{"type":"boolean"}}}}}}';
    const fulfilmentSpec = '{"requests":[{"topic":"order:submitted","request":{"$ref":"#/components/schemas/S"}}],"components":{"schemas":{"S":{"type":"object","properties":{"id":{"type":"string"}}}}}}';

    const handler = routingFetch()
      .mapGet(SpecUrl, 200, ordersSpec)
      .mapGet(HealthUrl, 200, serializeHealth(true))
      .mapGet(paymentsSpecUrl, 200, fulfilmentSpec)
      .mapGet(paymentsHealthUrl, 200, serializeHealth(true));
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const aggregator = httpAggregator(handler, store);

    await aggregator.runOnceAsync(
      new MeshServiceRegistry([
        new MeshServiceRegistryEntry('orders-api', SpecUrl, HealthUrl),
        new MeshServiceRegistryEntry('fulfilment-api', paymentsSpecUrl, paymentsHealthUrl),
      ]),
    );

    const catalog = JSON.parse((await store.tryReadAsync('topics.json'))!) as Json;
    const submitted = catalog.topics.find((t: Json) => t.topic === 'order:submitted');

    expect(submitted.consumers).toHaveLength(2);
    expect(submitted.schemaMismatch).toBe(false);
  });

  it('RunOnceAsync_ProducerEvent_CarriesMessageSchema', async () => {
    const ordersSpec = '{"events":[{"topic":"order:shipped","message":{"$ref":"#/components/schemas/Shipped"}}],"components":{"schemas":{"Shipped":{"type":"object","properties":{"trackingId":{"type":"string"}}}}}}';

    const handler = routingFetch().mapGet(SpecUrl, 200, ordersSpec).mapGet(HealthUrl, 200, serializeHealth(true));
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const aggregator = httpAggregator(handler, store);

    await aggregator.runOnceAsync(singleServiceRegistry());

    const catalog = JSON.parse((await store.tryReadAsync('topics.json'))!) as Json;
    const shipped = catalog.topics.find((t: Json) => t.topic === 'order:shipped');

    expect(shipped.messageSchema).not.toBeUndefined();
    expect(shipped.messageSchema.title).toBe('Shipped');
    expect(shipped.messageSchema.properties.trackingId.type).toBe('string');
    expect(shipped.schemaMismatch).toBe(false);
  });

  it('RunOnceAsync_TopicCatalog_KeysByVersion_AndFlagsDeprecationCandidateAndGap', async () => {
    const paymentsSpecUrl = 'https://payments-api.example/spec?type=benzene';
    const paymentsHealthUrl = 'https://payments-api.example/healthcheck';
    const ordersSpec = '{"requests":[],"events":[{"topic":"shipping:booked","version":"v1"},{"topic":"shipping:booked","version":"v2"}]}';
    const paymentsSpec = '{"requests":[{"topic":"shipping:booked","version":"v2"},{"topic":"legacy:refund"}],"events":[]}';

    const handler = routingFetch()
      .mapGet(SpecUrl, 200, ordersSpec)
      .mapGet(HealthUrl, 200, serializeHealth(true))
      .mapGet(paymentsSpecUrl, 200, paymentsSpec)
      .mapGet(paymentsHealthUrl, 200, serializeHealth(true));
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const aggregator = httpAggregator(handler, store);

    await aggregator.runOnceAsync(
      new MeshServiceRegistry([
        new MeshServiceRegistryEntry('orders-api', SpecUrl, HealthUrl),
        new MeshServiceRegistryEntry('payments-api', paymentsSpecUrl, paymentsHealthUrl),
      ]),
    );

    const catalog = JSON.parse((await store.tryReadAsync('topics.json'))!) as Json;

    const bookedV1 = catalog.topics.find((t: Json) => t.topic === 'shipping:booked' && t.version === 'v1');
    const bookedV2 = catalog.topics.find((t: Json) => t.topic === 'shipping:booked' && t.version === 'v2');

    expect(bookedV1.producers[0].service).toBe('orders-api');
    expect(bookedV1.consumers).toHaveLength(0);
    expect(bookedV1.status).toBe(MeshTopicStatus.deprecationCandidate);

    expect(bookedV2.producers[0].service).toBe('orders-api');
    expect(bookedV2.consumers[0].service).toBe('payments-api');
    expect(bookedV2.status ?? undefined).toBeUndefined();

    const refund = catalog.topics.find((t: Json) => t.topic === 'legacy:refund');
    expect(refund.producers).toHaveLength(0);
    expect(refund.consumers[0].service).toBe('payments-api');
    expect(refund.status).toBe(MeshTopicStatus.gap);
  });

  it('RunOnceAsync_DerivesStructuralTopology_FromSenderToHandler', async () => {
    const paymentsSpecUrl = 'https://payments-api.example/spec?type=benzene';
    const paymentsHealthUrl = 'https://payments-api.example/healthcheck';
    const ordersSpec = '{"requests":[{"topic":"orders:create"}],"events":[{"topic":"payments:capture"}]}';
    const paymentsSpec = '{"requests":[{"topic":"payments:capture"}]}';

    const handler = routingFetch()
      .mapGet(SpecUrl, 200, ordersSpec)
      .mapGet(HealthUrl, 200, serializeHealth(true))
      .mapGet(paymentsSpecUrl, 200, paymentsSpec)
      .mapGet(paymentsHealthUrl, 200, serializeHealth(true));
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const aggregator = httpAggregator(handler, store);

    await aggregator.runOnceAsync(
      new MeshServiceRegistry([
        new MeshServiceRegistryEntry('orders-api', SpecUrl, HealthUrl),
        new MeshServiceRegistryEntry('payments-api', paymentsSpecUrl, paymentsHealthUrl),
      ]),
    );

    const json = await store.tryReadAsync('topology.json');
    expect(json).not.toBeUndefined();
    const topology = JSON.parse(json!) as Json;

    expect(topology.edges).toHaveLength(1);
    const edge = topology.edges[0];
    expect(edge.client).toBe('orders-api');
    expect(edge.server).toBe('payments-api');
    expect(edge.source).toBe(TopologyEdgeSource.structural);
    expect(edge.requestsPerMinute).toBeUndefined();
    expect(edge.errorRate).toBeUndefined();
  });

  // ---- usage -> structural-edge attribution ----
  const UsageAtMs = Date.UTC(2026, 6, 23, 9, 0, 0);

  const usageOverTenMinutes = (...entries: MeshUsageEntry[]): MeshUsage =>
    new MeshUsage(UsageAtMs, UsageAtMs - minutes(10), UsageAtMs, entries);

  async function runTopology(services: [string, string][], usage: MeshUsage | undefined): Promise<Json> {
    const handler = routingFetch();
    const registryEntries: MeshServiceRegistryEntry[] = [];
    for (const [name, spec] of services) {
      const specUrl = `https://${name}.example/spec?type=benzene`;
      const healthUrl = `https://${name}.example/healthcheck`;
      handler.mapGet(specUrl, 200, spec).mapGet(healthUrl, 200, serializeHealth(true));
      registryEntries.push(new MeshServiceRegistryEntry(name, specUrl, healthUrl));
    }

    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const usageSources = usage !== undefined ? [new StubUsageSource(usage)] : [];
    const aggregator = httpAggregator(handler, store, () => UsageAtMs, usageSources);

    await aggregator.runOnceAsync(new MeshServiceRegistry(registryEntries));
    return JSON.parse((await store.tryReadAsync('topology.json'))!) as Json;
  }

  const edge = (topology: Json, client: string, server: string): Json =>
    topology.edges.find((e: Json) => e.client === client && e.server === server);

  it('RunOnceAsync_SingleProducerSingleConsumer_AttributesReqPerMinuteAndErrorRate', async () => {
    const topology = await runTopology(
      [
        ['orders-api', '{"events":[{"topic":"payments:capture"}]}'],
        ['payments-api', '{"requests":[{"topic":"payments:capture"}]}'],
      ],
      usageOverTenMinutes(
        new MeshUsageEntry('payments:capture', undefined, undefined, undefined, 'success', 8, undefined, 'cw'),
        new MeshUsageEntry('payments:capture', undefined, undefined, undefined, 'failure', 2, undefined, 'cw'),
      ),
    );

    const e = edge(topology, 'orders-api', 'payments-api');
    expect(e.requestsPerMinute).toBeCloseTo(1.0, 5); // 10 messages / 10 minutes
    expect(e.errorRate).toBeCloseTo(0.2, 5); // 2 of 10 failed
    expect(e.p50LatencyMs).toBeUndefined();
    expect(e.p95LatencyMs).toBeUndefined();
    expect(e.p99LatencyMs).toBeUndefined();
  });

  it('RunOnceAsync_ItemizedFailureStatuses_CountTowardErrorRate', async () => {
    const topology = await runTopology(
      [
        ['orders-api', '{"events":[{"topic":"payments:capture"}]}'],
        ['payments-api', '{"requests":[{"topic":"payments:capture"}]}'],
      ],
      // Wire statuses use the TS port's status vocabulary (PascalCase `BenzeneResultStatus` values) where
      // the C# original used its lowercase-kebab wire values - the port-wide `@benzenejs/results` divergence.
      usageOverTenMinutes(
        new MeshUsageEntry('payments:capture', undefined, undefined, undefined, 'success', 6, undefined, 'cw'),
        new MeshUsageEntry('payments:capture', undefined, undefined, undefined, BenzeneResultStatus.notFound, 2, undefined, 'cw'),
        new MeshUsageEntry('payments:capture', undefined, undefined, undefined, BenzeneResultStatus.unauthorized, 1, undefined, 'cw'),
        new MeshUsageEntry('payments:capture', undefined, undefined, undefined, 'exception', 1, undefined, 'cw'),
      ),
    );

    const e = edge(topology, 'orders-api', 'payments-api');
    expect(e.requestsPerMinute).toBeCloseTo(1.0, 5);
    expect(e.errorRate).toBeCloseTo(0.4, 5); // 4 of 10 (NotFound + Unauthorized + exception)
  });

  it('RunOnceAsync_CollectorWireStatuses_AreClassifiedBySuccessClass', async () => {
    const topology = await runTopology(
      [
        ['orders-api', '{"events":[{"topic":"payments:capture"}]}'],
        ['payments-api', '{"requests":[{"topic":"payments:capture"}]}'],
      ],
      usageOverTenMinutes(
        new MeshUsageEntry('payments:capture', undefined, undefined, undefined, BenzeneResultStatus.ok, 6, undefined, 'collector'),
        new MeshUsageEntry('payments:capture', undefined, undefined, undefined, BenzeneResultStatus.notFound, 4, undefined, 'collector'),
      ),
    );

    expect(edge(topology, 'orders-api', 'payments-api').errorRate).toBeCloseTo(0.4, 5); // 4 of 10 NotFound
  });

  it('RunOnceAsync_UnknownStatus_IsUnclassifiable_BlanksErrorRateButShowsReqPerMinute', async () => {
    const topology = await runTopology(
      [
        ['orders-api', '{"events":[{"topic":"payments:capture"}]}'],
        ['payments-api', '{"requests":[{"topic":"payments:capture"}]}'],
      ],
      usageOverTenMinutes(
        new MeshUsageEntry('payments:capture', undefined, undefined, undefined, 'success', 6, undefined, 'cw'),
        new MeshUsageEntry('payments:capture', undefined, undefined, undefined, 'SomethingCustom', 4, undefined, 'cw'),
      ),
    );

    const e = edge(topology, 'orders-api', 'payments-api');
    expect(e.requestsPerMinute).toBeCloseTo(1.0, 5);
    expect(e.errorRate).toBeUndefined();
  });

  it('RunOnceAsync_MultiProducerTopic_LeavesBothEdgesUnattributed', async () => {
    const topology = await runTopology(
      [
        ['orders-api', '{"events":[{"topic":"payments:capture"}]}'],
        ['checkout-api', '{"events":[{"topic":"payments:capture"}]}'],
        ['payments-api', '{"requests":[{"topic":"payments:capture"}]}'],
      ],
      usageOverTenMinutes(new MeshUsageEntry('payments:capture', undefined, undefined, undefined, 'success', 10, undefined, 'cw')),
    );

    expect(edge(topology, 'orders-api', 'payments-api').requestsPerMinute).toBeUndefined();
    expect(edge(topology, 'checkout-api', 'payments-api').requestsPerMinute).toBeUndefined();
  });

  it('RunOnceAsync_FanOutTopic_ServiceDimensionAbsent_LeavesEdgesUnattributed', async () => {
    const topology = await runTopology(
      [
        ['orders-api', '{"events":[{"topic":"order:shipped"}]}'],
        ['shipping-api', '{"requests":[{"topic":"order:shipped"}]}'],
        ['analytics-api', '{"requests":[{"topic":"order:shipped"}]}'],
      ],
      usageOverTenMinutes(new MeshUsageEntry('order:shipped', undefined, undefined, undefined, 'success', 20, undefined, 'cw')),
    );

    expect(edge(topology, 'orders-api', 'shipping-api').requestsPerMinute).toBeUndefined();
    expect(edge(topology, 'orders-api', 'analytics-api').requestsPerMinute).toBeUndefined();
  });

  it('RunOnceAsync_FanOutTopic_ServiceDimensionPresent_AttributesPerConsumer', async () => {
    const topology = await runTopology(
      [
        ['orders-api', '{"events":[{"topic":"order:shipped"}]}'],
        ['shipping-api', '{"requests":[{"topic":"order:shipped"}]}'],
        ['analytics-api', '{"requests":[{"topic":"order:shipped"}]}'],
      ],
      usageOverTenMinutes(
        new MeshUsageEntry('order:shipped', undefined, 'shipping-api', undefined, 'success', 5, undefined, 'cw'),
        new MeshUsageEntry('order:shipped', undefined, 'analytics-api', undefined, 'success', 3, undefined, 'cw'),
      ),
    );

    expect(edge(topology, 'orders-api', 'shipping-api').requestsPerMinute).toBeCloseTo(0.5, 5); // 5 / 10 min
    expect(edge(topology, 'orders-api', 'analytics-api').requestsPerMinute).toBeCloseTo(0.3, 5); // 3 / 10 min
  });

  it('RunOnceAsync_MultiTopicEdge_OneAmbiguousTopic_BlanksTheWholeEdge', async () => {
    const topology = await runTopology(
      [
        ['orders-api', '{"events":[{"topic":"capture:one"},{"topic":"refund:two"}]}'],
        ['checkout-api', '{"events":[{"topic":"refund:two"}]}'],
        ['payments-api', '{"requests":[{"topic":"capture:one"},{"topic":"refund:two"}]}'],
      ],
      usageOverTenMinutes(
        new MeshUsageEntry('capture:one', undefined, undefined, undefined, 'success', 10, undefined, 'cw'),
        new MeshUsageEntry('refund:two', undefined, undefined, undefined, 'success', 4, undefined, 'cw'),
      ),
    );

    expect(edge(topology, 'orders-api', 'payments-api').requestsPerMinute).toBeUndefined();
    expect(edge(topology, 'orders-api', 'payments-api').errorRate).toBeUndefined();
  });

  it('RunOnceAsync_UnclassifiableStatus_ShowsReqPerMinuteButNotErrorRate', async () => {
    const topology = await runTopology(
      [
        ['orders-api', '{"events":[{"topic":"payments:capture"}]}'],
        ['payments-api', '{"requests":[{"topic":"payments:capture"}]}'],
      ],
      usageOverTenMinutes(
        new MeshUsageEntry('payments:capture', undefined, undefined, undefined, 'success', 6, undefined, 'cw'),
        new MeshUsageEntry('payments:capture', undefined, undefined, undefined, '<missing>', 4, undefined, 'cw'),
      ),
    );

    const e = edge(topology, 'orders-api', 'payments-api');
    expect(e.requestsPerMinute).toBeCloseTo(1.0, 5); // 10 / 10 min - the <missing> messages still count
    expect(e.errorRate).toBeUndefined(); // outcome unknown for some -> no honest error rate
  });

  it('RunOnceAsync_NoBoundedWindow_LeavesMetricsUnattributed', async () => {
    const topology = await runTopology(
      [
        ['orders-api', '{"events":[{"topic":"payments:capture"}]}'],
        ['payments-api', '{"requests":[{"topic":"payments:capture"}]}'],
      ],
      new MeshUsage(UsageAtMs, undefined, undefined, [
        new MeshUsageEntry('payments:capture', undefined, undefined, undefined, 'success', 10, undefined, 'cw'),
      ]),
    );

    expect(edge(topology, 'orders-api', 'payments-api').requestsPerMinute).toBeUndefined();
    expect(edge(topology, 'orders-api', 'payments-api').errorRate).toBeUndefined();
  });

  it('RunOnceAsync_UnchangedSpec_SecondRun_NoDrift', async () => {
    const handler = routingFetch()
      .mapGet(SpecUrl, 200, '{"info":{"title":"orders-api"}}')
      .mapGet(HealthUrl, 200, serializeHealth(true));
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const aggregator = httpAggregator(handler, store);

    await aggregator.runOnceAsync(singleServiceRegistry());
    const manifest = await aggregator.runOnceAsync(singleServiceRegistry());

    expect(manifest.services[0]!.contractDrift).toBe(false);
  });

  it('RunOnceAsync_ChangedSpec_SecondRun_ReportsDrift', async () => {
    const handler = routingFetch()
      .mapGet(SpecUrl, 200, '{"info":{"title":"orders-api"}}')
      .mapGet(HealthUrl, 200, serializeHealth(true));
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const aggregator = httpAggregator(handler, store);

    await aggregator.runOnceAsync(singleServiceRegistry());

    handler.mapGet(SpecUrl, 200, '{"info":{"title":"orders-api","version":"2"}}');
    const manifest = await aggregator.runOnceAsync(singleServiceRegistry());

    expect(manifest.services[0]!.contractDrift).toBe(true);
  });

  it('RunOnceAsync_RegistryEntryHasOwningTeam_ThreadsThroughToManifest', async () => {
    const handler = routingFetch()
      .mapGet(SpecUrl, 200, '{"info":{"title":"orders-api"}}')
      .mapGet(HealthUrl, 200, serializeHealth(true));
    const aggregator = httpAggregator(handler);

    const registry = new MeshServiceRegistry([
      new MeshServiceRegistryEntry('orders-api', SpecUrl, HealthUrl, MeshServiceSource.http, undefined, 'team-checkout'),
    ]);

    const manifest = await aggregator.runOnceAsync(registry);

    expect(manifest.services[0]!.owningTeam).toBe('team-checkout');
  });

  it('RunOnceAsync_RegistryEntryHasNoOwningTeam_ManifestOwningTeamIsUndefined', async () => {
    const handler = routingFetch()
      .mapGet(SpecUrl, 200, '{"info":{"title":"orders-api"}}')
      .mapGet(HealthUrl, 200, serializeHealth(true));
    const aggregator = httpAggregator(handler);

    const manifest = await aggregator.runOnceAsync(singleServiceRegistry());

    expect(manifest.services[0]!.owningTeam).toBeUndefined();
  });

  it('RunOnceAsync_SpecAdvertisesTransports_ThreadsThroughToManifest', async () => {
    const handler = routingFetch()
      .mapGet(SpecUrl, 200, '{"info":{"title":"orders-api"},"transports":["sqs","http"]}')
      .mapGet(HealthUrl, 200, serializeHealth(true));
    const aggregator = httpAggregator(handler);

    const manifest = await aggregator.runOnceAsync(singleServiceRegistry());

    expect(manifest.services[0]!.transports).toEqual(['sqs', 'http']);
  });

  it('RunOnceAsync_SpecHasNoTransports_ManifestTransportsIsEmpty', async () => {
    const handler = routingFetch()
      .mapGet(SpecUrl, 200, '{"info":{"title":"orders-api"}}')
      .mapGet(HealthUrl, 200, serializeHealth(true));
    const aggregator = httpAggregator(handler);

    const manifest = await aggregator.runOnceAsync(singleServiceRegistry());

    expect(manifest.services[0]!.transports).toHaveLength(0);
  });

  it('RunOnceAsync_HealthEndpointReportsUnhealthy_ManifestShowsUnhealthy', async () => {
    const handler = routingFetch()
      .mapGet(SpecUrl, 200, '{"info":{"title":"orders-api"}}')
      .mapGet(HealthUrl, 200, serializeHealth(false));
    const aggregator = httpAggregator(handler);

    const manifest = await aggregator.runOnceAsync(singleServiceRegistry());

    expect(manifest.services[0]!.status).toBe(MeshServiceStatus.unhealthy);
  });

  it('RunOnceAsync_HealthEndpointReports503Unhealthy_ManifestShowsUnhealthyNotUnreachable', async () => {
    // A real Benzene health check maps an unhealthy aggregate to HTTP 503, not a 200 with isHealthy:false.
    // The aggregator must still read and deserialize that body instead of treating 503 as unreachable.
    const handler = routingFetch()
      .mapGet(SpecUrl, 200, '{"info":{"title":"orders-api"}}')
      .mapGet(HealthUrl, 503, serializeHealth(false));
    const aggregator = httpAggregator(handler);

    const manifest = await aggregator.runOnceAsync(singleServiceRegistry());

    expect(manifest.services[0]!.status).toBe(MeshServiceStatus.unhealthy);
  });

  it('RunOnceAsync_BothEndpointsFail_ManifestShowsUnreachable_ErrorIsTypeNameOnly', async () => {
    const handler = routingFetch()
      .mapGet(SpecUrl, 500, 'connection string: secret-value')
      .mapGet(HealthUrl, 500, 'connection string: secret-value');
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const aggregator = httpAggregator(handler, store);

    const manifest = await aggregator.runOnceAsync(singleServiceRegistry());

    expect(manifest.services[0]!.status).toBe(MeshServiceStatus.unreachable);

    const snapshotJson = await store.tryReadAsync('services/orders-api.json');
    expect(snapshotJson).not.toBeUndefined();
    const snapshot = JSON.parse(snapshotJson!) as Json;
    expect(snapshot.error).not.toBeUndefined();
    expect(snapshot.error).not.toContain('secret-value');
    expect(snapshot.error).toBe('HttpRequestException');
  });

  it('RunOnceAsync_OneServiceUnreachable_OtherHealthy_BothPublished', async () => {
    const otherSpecUrl = 'https://payments-api.example/spec?type=benzene';
    const otherHealthUrl = 'https://payments-api.example/healthcheck';

    const handler = routingFetch()
      .mapGet(SpecUrl, 500, undefined)
      .mapGet(HealthUrl, 500, undefined)
      .mapGet(otherSpecUrl, 200, '{"info":{"title":"payments-api"}}')
      .mapGet(otherHealthUrl, 200, serializeHealth(true));

    const registry = new MeshServiceRegistry([
      new MeshServiceRegistryEntry('orders-api', SpecUrl, HealthUrl),
      new MeshServiceRegistryEntry('payments-api', otherSpecUrl, otherHealthUrl),
    ]);
    const aggregator = httpAggregator(handler);

    const manifest = await aggregator.runOnceAsync(registry);

    expect(manifest.services).toHaveLength(2);
    expect(manifest.services.find((x) => x.name === 'orders-api')!.status).toBe(MeshServiceStatus.unreachable);
    expect(manifest.services.find((x) => x.name === 'payments-api')!.status).toBe(MeshServiceStatus.healthy);
  });

  it('RunOnceAsync_EntryUsesNonHttpSource_ResolvesFromRegisteredSource_NotHttpClient', async () => {
    const handler = routingFetch();
    const fakeSource = new FakeMeshServiceSource('{"info":{"title":"orders-api"}}', serializeHealth(true));
    const aggregator = new MeshAggregator(
      [new HttpMeshServiceSource(handler.fetchFn), fakeSource],
      new FileSystemMeshArtifactStore(rootDirectory),
    );

    const registry = new MeshServiceRegistry([new MeshServiceRegistryEntry('orders-api', SpecUrl, HealthUrl, 'fake', undefined)]);

    const manifest = await aggregator.runOnceAsync(registry);

    expect(manifest.services[0]!.status).toBe(MeshServiceStatus.healthy);
    expect(fakeSource.wasCalled).toBe(true);
  });

  it('RunOnceAsync_EntryUsesUnregisteredSource_ManifestShowsUnreachable_DoesNotCrashOtherServices', async () => {
    const handler = routingFetch()
      .mapGet(SpecUrl, 200, '{"info":{"title":"orders-api"}}')
      .mapGet(HealthUrl, 200, serializeHealth(true));
    const aggregator = httpAggregator(handler);

    const registry = new MeshServiceRegistry([
      new MeshServiceRegistryEntry('orders-api', SpecUrl, HealthUrl),
      new MeshServiceRegistryEntry('payments-fn', 'n/a', 'n/a', 'AwsLambdaInvoke', undefined),
    ]);

    const manifest = await aggregator.runOnceAsync(registry);

    expect(manifest.services).toHaveLength(2);
    expect(manifest.services.find((x) => x.name === 'orders-api')!.status).toBe(MeshServiceStatus.healthy);
    expect(manifest.services.find((x) => x.name === 'payments-fn')!.status).toBe(MeshServiceStatus.unreachable);
  });

  // ---- catalog diff ----
  function catalogDiffAggregator(specJson: string, store: IMeshArtifactStore): MeshAggregator {
    const handler = routingFetch().mapGet(SpecUrl, 200, specJson).mapGet(HealthUrl, 200, serializeHealth(true));
    return httpAggregator(handler, store);
  }

  const readCatalog = async (store: IMeshArtifactStore): Promise<Json> => JSON.parse((await store.tryReadAsync('topics.json'))!) as Json;

  it('RunOnceAsync_FirstRun_ClaimsNoTopicChanges', async () => {
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    await catalogDiffAggregator('{"requests":[{"topic":"order:create"}]}', store).runOnceAsync(singleServiceRegistry());

    const catalog = await readCatalog(store);

    expect(catalog.topics.find((t: Json) => t.topic === 'order:create').changes).toHaveLength(0);
    expect(catalog.removedTopics).toHaveLength(0);
  });

  it('RunOnceAsync_SecondRun_FlagsANewlyDeclaredTopic', async () => {
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    await catalogDiffAggregator('{"requests":[{"topic":"order:create"}]}', store).runOnceAsync(singleServiceRegistry());
    await catalogDiffAggregator('{"requests":[{"topic":"order:create"},{"topic":"order:refund"}]}', store).runOnceAsync(singleServiceRegistry());

    const catalog = await readCatalog(store);

    const refund = catalog.topics.find((t: Json) => t.topic === 'order:refund');
    expect(refund.changes).toHaveLength(1);
    expect(refund.changes[0].kind).toBe(MeshTopicChangeKind.added);
    expect(catalog.topics.find((t: Json) => t.topic === 'order:create').changes).toHaveLength(0);
  });

  it('RunOnceAsync_SecondRun_FlagsASchemaChangeWithTheChangedSide', async () => {
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    await catalogDiffAggregator(
      '{"requests":[{"topic":"order:create","request":{"type":"object","properties":{"id":{"type":"string"}}}}]}',
      store,
    ).runOnceAsync(singleServiceRegistry());
    await catalogDiffAggregator(
      '{"requests":[{"topic":"order:create","request":{"type":"object","properties":{"id":{"type":"integer"}}}}]}',
      store,
    ).runOnceAsync(singleServiceRegistry());

    const catalog = await readCatalog(store);

    const changes = catalog.topics.find((t: Json) => t.topic === 'order:create').changes;
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe(MeshTopicChangeKind.schemaChanged);
    expect(changes[0].description).toContain('request');
  });

  it('RunOnceAsync_SecondRun_FlagsAConsumerSetChange', async () => {
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const spec = '{"requests":[{"topic":"order:create"}]}';
    await catalogDiffAggregator(spec, store).runOnceAsync(singleServiceRegistry());
    await catalogDiffAggregator(spec, store).runOnceAsync(
      new MeshServiceRegistry([new MeshServiceRegistryEntry('orders-api-v2', SpecUrl, HealthUrl)]),
    );

    const catalog = await readCatalog(store);

    const changes = catalog.topics.find((t: Json) => t.topic === 'order:create').changes;
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe(MeshTopicChangeKind.consumersChanged);
    expect(changes[0].description).toContain('+orders-api-v2');
    expect(changes[0].description).toContain('-orders-api');
  });

  it('RunOnceAsync_SecondRun_RecordsAVanishedTopicOnTheCatalog', async () => {
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    await catalogDiffAggregator('{"requests":[{"topic":"order:create"},{"topic":"order:legacy-export","version":"v1"}]}', store).runOnceAsync(
      singleServiceRegistry(),
    );
    await catalogDiffAggregator('{"requests":[{"topic":"order:create"}]}', store).runOnceAsync(singleServiceRegistry());

    const catalog = await readCatalog(store);

    expect(catalog.removedTopics).toHaveLength(1);
    expect(catalog.removedTopics[0].topic).toBe('order:legacy-export');
    expect(catalog.removedTopics[0].version).toBe('v1');
    expect(catalog.topics.some((t: Json) => t.topic === 'order:legacy-export')).toBe(false);
  });

  it('RunOnceAsync_SecondRun_ReservedTopicChurnIsNeverFlagged', async () => {
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    await catalogDiffAggregator('{"requests":[{"topic":"spec","reserved":true}]}', store).runOnceAsync(singleServiceRegistry());
    await catalogDiffAggregator('{"requests":[{"topic":"spec","reserved":true},{"topic":"healthcheck","reserved":true}]}', store).runOnceAsync(
      singleServiceRegistry(),
    );

    const catalog = await readCatalog(store);

    for (const topic of catalog.topics as Json[]) {
      expect(topic.changes).toHaveLength(0);
    }
  });

  // ---- usage artifact ----
  it('RunOnceAsync_NoUsageSources_PublishesNoUsageArtifact', async () => {
    const handler = routingFetch()
      .mapGet(SpecUrl, 200, '{"info":{"title":"orders-api"}}')
      .mapGet(HealthUrl, 200, serializeHealth(true));
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const aggregator = httpAggregator(handler, store);

    await aggregator.runOnceAsync(singleServiceRegistry());

    expect(await store.tryReadAsync('usage.json')).toBeUndefined();
  });

  it('RunOnceAsync_UsageSourceReports_PublishesUsageJson', async () => {
    const at = Date.UTC(2026, 6, 22, 9, 0, 0);
    const handler = routingFetch()
      .mapGet(SpecUrl, 200, '{"info":{"title":"orders-api"}}')
      .mapGet(HealthUrl, 200, serializeHealth(true));
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const report = new MeshUsage(at - minutes(1), at - days(1), at, [
      new MeshUsageEntry('orders:create', 'v1', 'orders-api', 'Sqs', 'created', 42, 12.5, 'stub'),
    ]);
    const aggregator = httpAggregator(handler, store, () => at, [new StubUsageSource(report)]);

    await aggregator.runOnceAsync(singleServiceRegistry());

    const usage = JSON.parse((await store.tryReadAsync('usage.json'))!) as Json;
    expect(usage.generatedAtUtc).toBe(at); // the merged report is stamped by the run, not the source
    expect(usage.windowStartUtc).toBe(at - days(1));
    expect(usage.entries).toHaveLength(1);
    expect(usage.entries[0].topic).toBe('orders:create');
    expect(usage.entries[0].transport).toBe('Sqs');
    expect(usage.entries[0].count).toBe(42);
    expect(usage.entries[0].source).toBe('stub');
  });

  it('RunOnceAsync_MergesUsageSources_ConcatenatingEntriesAndWideningTheWindow', async () => {
    const at = Date.UTC(2026, 6, 22, 9, 0, 0);
    const handler = routingFetch()
      .mapGet(SpecUrl, 200, '{"info":{"title":"orders-api"}}')
      .mapGet(HealthUrl, 200, serializeHealth(true));
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const narrow = new MeshUsage(at, at - hours(1), at, [
      new MeshUsageEntry('orders:create', undefined, undefined, 'AspNet', 'created', 10, undefined, 'a'),
    ]);
    const wide = new MeshUsage(at, at - days(2), at - hours(2), [
      new MeshUsageEntry('orders:create', undefined, undefined, undefined, 'ok', 5, undefined, 'b'),
    ]);
    const aggregator = httpAggregator(handler, store, () => at, [new StubUsageSource(narrow), new StubUsageSource(wide)]);

    await aggregator.runOnceAsync(singleServiceRegistry());

    const usage = JSON.parse((await store.tryReadAsync('usage.json'))!) as Json;
    expect(usage.windowStartUtc).toBe(at - days(2));
    expect(usage.windowEndUtc).toBe(at);
    expect(usage.entries).toHaveLength(2);
    expect((usage.entries as Json[]).map((e) => e.source).sort()).toEqual(['a', 'b']);
  });

  it('RunOnceAsync_ThrowingUsageSource_ContributesNothingWithoutFailingTheRun', async () => {
    const at = Date.UTC(2026, 6, 22, 9, 0, 0);
    const handler = routingFetch()
      .mapGet(SpecUrl, 200, '{"info":{"title":"orders-api"}}')
      .mapGet(HealthUrl, 200, serializeHealth(true));
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const good = new MeshUsage(at, undefined, undefined, [
      new MeshUsageEntry('orders:create', undefined, undefined, undefined, undefined, 7, undefined, 'good'),
    ]);
    const aggregator = httpAggregator(handler, store, () => at, [new StubUsageSource(new Error('backend down')), new StubUsageSource(good)]);

    const manifest = await aggregator.runOnceAsync(singleServiceRegistry());

    expect(manifest.services[0]!.status).toBe(MeshServiceStatus.healthy);
    const usage = JSON.parse((await store.tryReadAsync('usage.json'))!) as Json;
    expect(usage.entries).toHaveLength(1);
    expect(usage.entries[0].source).toBe('good');
  });

  it('RunOnceAsync_AllUsageSourcesReturnUndefined_PublishesNoUsageArtifact', async () => {
    const handler = routingFetch()
      .mapGet(SpecUrl, 200, '{"info":{"title":"orders-api"}}')
      .mapGet(HealthUrl, 200, serializeHealth(true));
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const aggregator = httpAggregator(handler, store, undefined, [new StubUsageSource(undefined)]);

    await aggregator.runOnceAsync(singleServiceRegistry());

    expect(await store.tryReadAsync('usage.json')).toBeUndefined();
  });
});

function asyncApiDoc(title: string, topic: string, schema: string): string {
  const ch = topic.replace(/:/g, '_');
  return JSON.stringify({
    asyncapi: '3.0.0',
    info: { title, version: '1.0' },
    channels: {
      [ch]: { address: topic, messages: { [schema]: { payload: { $ref: `#/components/schemas/${schema}` } } } },
      spec: { address: 'spec', messages: {} },
    },
    operations: {
      [ch]: { action: 'receive', channel: { $ref: `#/channels/${ch}` }, messages: [{ $ref: `#/channels/${ch}/messages/${schema}` }] },
      spec: { action: 'receive', channel: { $ref: '#/channels/spec' } },
    },
    components: { schemas: { [schema]: { type: 'object', properties: { id: { type: 'string' } } } } },
  });
}
