import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Context } from 'aws-lambda';
import { MeshServiceStatus } from '@benzenejs/mesh-contracts';
import { MeshServiceSource } from '@benzenejs/mesh-contracts';
import { httpBuilder, messageBuilder } from '@benzenejs/testing';
import { asApiGatewayRequest, asSqs } from '@benzenejs/aws-lambda-testing';
import { buildServiceLambdas, receipts, runMeshAggregation } from '@benzene-example/aws-lambda-mesh';

/**
 * Proves the AWS Lambda mesh works end-to-end in TypeScript, the same way the .NET `examples/AwsMesh` does:
 * six Benzene Cloud Service Lambdas are discovered by tag, interrogated by a (in-memory) synchronous Lambda
 * invoke on the reserved `spec`/`healthcheck` topics, and aggregated into a catalog whose topics and
 * structural topology reflect the real estate — with no cloud account.
 */
describe('AWS Lambda mesh (end-to-end, in-memory)', () => {
  let rootDirectory: string;

  beforeEach(() => {
    rootDirectory = mkdtempSync(join(tmpdir(), 'benzene-aws-lambda-mesh-'));
    receipts.length = 0;
  });
  afterEach(() => {
    rmSync(rootDirectory, { recursive: true, force: true });
  });

  it('discovers all six tagged Lambdas as aws-lambda-invoke entries', async () => {
    const { registry } = await runMeshAggregation(buildServiceLambdas(), rootDirectory);

    expect(registry.services.map((s) => s.name).sort()).toEqual([
      'analytics-api',
      'inventory-api',
      'notifications-api',
      'orders-api',
      'payments-api',
      'shipping-api',
    ]);
    // Every entry is interrogated over the Lambda-invoke source (not HTTP).
    expect(registry.services.every((s) => s.source === MeshServiceSource.awsLambdaInvoke)).toBe(true);
  });

  it('interrogates each Lambda and reports every service healthy', async () => {
    const { manifest } = await runMeshAggregation(buildServiceLambdas(), rootDirectory);

    expect(manifest.services).toHaveLength(6);
    expect(manifest.services.every((s) => s.status === MeshServiceStatus.healthy)).toBe(true);

    // The self-derived transports come back in the manifest (payments listens on http + sqs).
    const payments = manifest.services.find((s) => s.name === 'payments-api')!;
    expect([...payments.transports].sort()).toEqual(['http', 'sqs']);
  });

  it('catalogs the cross-service topics with producers and consumers', async () => {
    const { store } = await runMeshAggregation(buildServiceLambdas(), rootDirectory);
    const catalog = JSON.parse((await store.tryReadAsync('topics.json'))!) as {
      topics: { topic: string; consumers: { service: string }[]; producers: { service: string }[] }[];
    };
    const byTopic = (t: string) => catalog.topics.find((x) => x.topic === t)!;
    const names = (xs: { service: string }[]) => xs.map((x) => x.service).sort();

    // order:placed — produced by orders, fanned out to inventory + notifications.
    expect(names(byTopic('order:placed').producers)).toEqual(['orders-api']);
    expect(names(byTopic('order:placed').consumers)).toEqual(['inventory-api', 'notifications-api']);

    // payment:captured — produced by payments, consumed by analytics + notifications.
    expect(names(byTopic('payment:captured').producers)).toEqual(['payments-api']);
    expect(names(byTopic('payment:captured').consumers)).toEqual(['analytics-api', 'notifications-api']);

    // shipment:dispatched — produced by shipping, consumed by inventory + notifications + analytics.
    expect(names(byTopic('shipment:dispatched').producers)).toEqual(['shipping-api']);
    expect(names(byTopic('shipment:dispatched').consumers)).toEqual([
      'analytics-api',
      'inventory-api',
      'notifications-api',
    ]);

    // payments:capture — a point-to-point command orders → payments.
    expect(names(byTopic('payments:capture').producers)).toEqual(['orders-api']);
    expect(names(byTopic('payments:capture').consumers)).toEqual(['payments-api']);
  });

  it('carries each topic\'s payload JSON Schema (derived from the services\' Zod schemas)', async () => {
    const { store } = await runMeshAggregation(buildServiceLambdas(), rootDirectory);
    const catalog = JSON.parse((await store.tryReadAsync('topics.json'))!) as {
      topics: {
        topic: string;
        requestSchema?: { type?: string; properties?: Record<string, { type?: string; minLength?: number }> };
        responseSchema?: { properties?: Record<string, unknown> };
      }[];
    };
    const byTopic = (t: string) => catalog.topics.find((x) => x.topic === t)!;

    // orders:create — request + response payloads, with the Zod min-length rule carried into the schema.
    const create = byTopic('orders:create');
    expect(create.requestSchema).toMatchObject({
      type: 'object',
      properties: { orderId: { type: 'string', minLength: 1 } },
    });
    expect(create.responseSchema?.properties).toHaveProperty('orderId');

    // Every domain topic carries its request payload schema (sourced from its consumer's Zod schema).
    for (const topic of ['payments:capture', 'order:placed', 'payment:captured', 'shipment:dispatched', 'shipping:book']) {
      expect(byTopic(topic).requestSchema?.properties).toHaveProperty('orderId');
    }
  });

  it('derives the structural topology (producer → consumer edges) from the specs', async () => {
    const { store } = await runMeshAggregation(buildServiceLambdas(), rootDirectory);
    const topology = JSON.parse((await store.tryReadAsync('topology.json'))!) as {
      edges: { client: string; server: string; source: string }[];
    };
    const edge = (client: string, server: string) =>
      topology.edges.some((e) => e.client === client && e.server === server);

    // 9 structural edges across the estate (client = producer, server = consumer).
    expect(topology.edges).toHaveLength(9);
    expect(edge('orders-api', 'payments-api')).toBe(true); // payments:capture (SQS)
    expect(edge('orders-api', 'inventory-api')).toBe(true); // order:placed (SNS fan-out)
    expect(edge('orders-api', 'notifications-api')).toBe(true); // order:placed (SNS fan-out)
    expect(edge('payments-api', 'shipping-api')).toBe(true); // shipping:book (SQS)
    expect(edge('payments-api', 'analytics-api')).toBe(true); // payment:captured (EventBridge)
    expect(edge('shipping-api', 'inventory-api')).toBe(true); // shipment:dispatched (EventBridge)
    expect(topology.edges.every((e) => e.source === 'structural')).toBe(true);
  });

  it('a service answers a direct Lambda invoke on the reserved spec topic (the interrogation surface)', async () => {
    const services = buildServiceLambdas();

    const response = (await services['orders-api']!(
      { topic: 'spec', headers: {}, body: '' },
      {} as Context,
      () => undefined,
    )) as { statusCode: number; body: string };

    const spec = JSON.parse(response.body) as { requests: { topic: string }[]; events: { topic: string }[]; transports: string[] };
    expect(spec.requests.map((r) => r.topic)).toContain('orders:create');
    expect(spec.events.map((e) => e.topic).sort()).toEqual(['order:placed', 'payments:capture']);
    expect(spec.transports).toContain('http');
  });

  it('a service answers the reserved healthcheck invoke with a real HealthCheckResponse (per-check status + dependencies)', async () => {
    const services = buildServiceLambdas();

    const response = (await services['orders-api']!(
      { topic: 'healthcheck', headers: {}, body: '' },
      {} as Context,
      () => undefined,
    )) as { statusCode: number; body: string };

    // The `@benzenejs/health-checks` middleware served it — the canonical { isHealthy, healthChecks } wire
    // shape the mesh + cross-language Mesh UI read, NOT the old hand-rolled { isHealthy, checks:[…] } blob.
    const health = JSON.parse(response.body) as {
      isHealthy: boolean;
      healthChecks: Record<string, { status: string; type: string; data: Record<string, unknown>; dependencies: { kind: string; name: string }[] }>;
    };
    expect(health.isHealthy).toBe(true);
    // The explicit domain checks (PostgresDatabase, SqsQueue) PLUS the transport reachability checks the
    // outbound clients auto-register: orders sends payments:capture over SQS (-> Sqs) and order:placed
    // over SNS (-> Sns). This is the .NET behaviour — wiring `useSqs`/`useSns` contributes a dependency
    // health check to the deep healthcheck layer, so the mesh surfaces transport health for free.
    expect(Object.keys(health.healthChecks).sort()).toEqual(['PostgresDatabase', 'Sns', 'Sqs', 'SqsQueue']);

    const db = health.healthChecks['PostgresDatabase']!;
    expect(db.status).toBe('ok');
    expect(db.type).toBe('PostgresDatabase');
    expect(db.data['latencyMs']).toBe(4);
    expect(db.dependencies).toEqual([{ kind: 'Database', name: 'orders-db' }]);

    const queue = health.healthChecks['SqsQueue']!;
    expect(queue.status).toBe('ok');
    expect(queue.dependencies).toEqual([{ kind: 'Queue', name: 'order-events' }]);
  });

  it('writes each service\'s per-check health (status + dependencies) into services/{name}.json', async () => {
    const { store } = await runMeshAggregation(buildServiceLambdas(), rootDirectory);

    const snapshot = JSON.parse((await store.tryReadAsync('services/payments-api.json'))!) as {
      health: {
        isHealthy: boolean;
        healthChecks: Record<string, { status: string; type: string; dependencies: { kind: string; name: string }[] }>;
      };
    };

    // The aggregator stored the service's HealthCheckResponse verbatim — the Mesh UI's per-service,
    // per-check health view reads exactly this. payments has the explicit domain checks (PaymentGateway,
    // PostgresDatabase) PLUS the transport checks auto-registered by its outbound clients: it sends
    // shipping:book over SQS (-> Sqs) and payment:captured over EventBridge (-> EventBridge).
    expect(snapshot.health.isHealthy).toBe(true);
    expect(Object.keys(snapshot.health.healthChecks).sort()).toEqual([
      'EventBridge',
      'PaymentGateway',
      'PostgresDatabase',
      'Sqs',
    ]);
    expect(snapshot.health.healthChecks['PaymentGateway']!.dependencies).toEqual([
      { kind: 'Http', name: 'stripe-gateway' },
    ]);
  });

  it('the same service also handles its domain topic over a real transport (SQS)', async () => {
    const services = buildServiceLambdas();

    await services['payments-api']!(
      asSqs(messageBuilder('payments:capture', { orderId: 'p-1' })),
      {} as Context,
      () => undefined,
    );

    // The SQS-delivered command reached the payments domain handler.
    expect(receipts).toContain('payments<-payments:capture:p-1');
  });
});

describe('AWS Lambda mesh (runtime cascade via the outbound clients)', () => {
  beforeEach(() => {
    receipts.length = 0;
  });

  it('a single POST /orders fans through all six services over SQS, SNS, and EventBridge', async () => {
    const services = buildServiceLambdas();

    // One HTTP request into orders — everything else happens by real outbound sends onto the in-memory bus.
    await services['orders-api']!(
      asApiGatewayRequest(httpBuilder('POST', '/orders', { orderId: 'X' })),
      {} as Context,
      () => undefined,
    );

    // orders → payments (SQS) → shipping (SQS); orders → inventory/notifications (SNS fan-out);
    // payments → analytics/notifications (EventBridge); shipping → inventory/notifications/analytics (EventBridge).
    expect(receipts).toContain('orders<-orders:create:X');
    expect(receipts).toContain('payments<-payments:capture:X'); // SQS command
    expect(receipts).toContain('shipping<-shipping:book:X'); // SQS command (second hop)
    expect(receipts).toContain('inventory<-order:placed:X'); // SNS fan-out
    expect(receipts).toContain('notifications<-order:placed:X'); // SNS fan-out
    expect(receipts).toContain('analytics<-payment:captured:X'); // EventBridge
    expect(receipts).toContain('notifications<-payment:captured:X'); // EventBridge fan-out
    expect(receipts).toContain('inventory<-shipment:dispatched:X'); // EventBridge (third hop)
    expect(receipts).toContain('analytics<-shipment:dispatched:X'); // EventBridge (third hop)

    // The full cascade: every service received at least one message.
    const servicesTouched = new Set(receipts.map((r) => r.split('<-')[0]));
    expect([...servicesTouched].sort()).toEqual([
      'analytics',
      'inventory',
      'notifications',
      'orders',
      'payments',
      'shipping',
    ]);
  });
});
