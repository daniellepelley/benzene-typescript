import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InvocationContext } from '@azure/functions';
import { messageBuilder } from '@benzenejs/testing';
import { asAzureServiceBusMessage, asEventHubBenzeneMessage } from '@benzenejs/azure-function-testing';
import { BenzeneStartUp } from '@benzenejs/abstractions-middleware';
import { AzureFunctionHost } from '@benzenejs/azure-function-core';
import { handleEventGridEvent } from '@benzenejs/azure-function-event-grid';
import { FileSystemMeshArtifactStore, MeshAggregator } from '@benzenejs/mesh-aggregator';
import {
  IMeshDiscoveryProvider,
  MeshDiscoveryFilter,
  MeshDiscoveryRunner,
  MeshServiceRegistry,
  MeshServiceRegistryEntry,
  MeshServiceSource,
  MeshServiceStatus,
} from '@benzenejs/mesh-contracts';
import { AzureAppServiceDiscoveryProvider } from '@benzenejs/mesh-discovery-azure';
import { HttpMeshServiceSource } from '@benzenejs/mesh-aggregator';
import {
  AnalyticsEventGridStartUp,
  AnalyticsHttpStartUp,
  InventoryEventGridStartUp,
  InventoryEventHubStartUp,
  InventoryHttpStartUp,
  NotificationsEventGridStartUp,
  NotificationsEventHubStartUp,
  NotificationsHttpStartUp,
  OrdersStartUp,
  PaymentsHttpStartUp,
  PaymentsServiceBusStartUp,
  ShippingHttpStartUp,
  ShippingServiceBusStartUp,
} from '../../../examples/azure-functions-mesh/src/startUps';
import { MeshAggregationService } from '../../../examples/azure-functions-mesh/src/mesh/meshAggregation';
import {
  listenHttpFunction,
  RunningFunctionHost,
  stubResourceLister,
  taggedResource,
} from '../../../examples/azure-functions-mesh/src/localAzureEnvironment';
import { analyticsReceipts } from '../../../examples/azure-functions-mesh/src/domain/analytics';
import { inventoryReceipts } from '../../../examples/azure-functions-mesh/src/domain/inventory';
import { notificationsReceipts } from '../../../examples/azure-functions-mesh/src/domain/notifications';

/**
 * Proves the Azure Functions mesh works end-to-end in TypeScript, the way .NET's
 * `examples/AzureFunctionsMesh` does: six Benzene Cloud Service Function Apps are discovered by tag via
 * Azure Resource Manager, interrogated over HTTPS on the reserved `/benzene/spec` and `/benzene/health`
 * routes, and aggregated into a catalog whose topics and structural topology reflect the real estate —
 * with no cloud account. Mirrors `AwsLambdaMeshExampleTest.test.ts`'s in-process approach, using the two
 * in-process stand-ins `src/localAzureEnvironment.ts` provides: a stub `IAzureResourceLister` (Azure
 * Resource Manager) and real local HTTP servers wrapping each service's actual built `AzureFunctionHost`
 * (proving the Function-to-Function HTTP interrogation path with genuine sockets, not mocked `fetch`).
 *
 * `AzureAppServiceDiscoveryProvider` always builds `https://` URLs (matching real Azure), so a local test
 * can't chain one discovery pass straight into interrogation without a TLS-terminating server — see
 * `localAzureEnvironment.ts`'s header comment. This file therefore verifies the two seams independently:
 * "discovery" below proves the real discovery-provider logic against the ARM stand-in; "interrogation +
 * aggregation" builds a registry directly against the local HTTP servers and runs the mesh's own
 * `MeshAggregationService` against it.
 */
function hostFor<T extends BenzeneStartUp>(StartUp: new () => T): AzureFunctionHost<T> {
  return new AzureFunctionHost(StartUp);
}

describe('Azure Functions mesh — discovery (in-process Azure Resource Manager stand-in)', () => {
  it('discovers the six benzene-tagged Function Apps as HTTP registry entries', async () => {
    const resources = [
      taggedResource('orders'),
      taggedResource('payments'),
      taggedResource('shipping'),
      taggedResource('inventory'),
      taggedResource('notifications'),
      taggedResource('analytics'),
      // The mesh's own Function App is deliberately NOT tagged, so it never discovers itself.
    ];
    const provider = new AzureAppServiceDiscoveryProvider(stubResourceLister(resources));
    const runner = new MeshDiscoveryRunner([provider]);

    const registry = await runner.discoverAsync(new MeshDiscoveryFilter());

    expect(registry.services.map((s) => s.name).sort()).toEqual([
      'analytics',
      'inventory',
      'notifications',
      'orders',
      'payments',
      'shipping',
    ]);
    expect(registry.services.every((s) => s.source === MeshServiceSource.http)).toBe(true);
    const orders = registry.services.find((s) => s.name === 'orders')!;
    expect(orders.specUrl).toBe('https://orders.azurewebsites.net/benzene/spec?type=benzene');
    expect(orders.healthUrl).toBe('https://orders.azurewebsites.net/benzene/health');
  });

  it('ignores an untagged resource (the mesh Function App itself)', async () => {
    const resources = [taggedResource('orders'), { name: 'mesh', location: 'westeurope', defaultHost: undefined, tags: {} }];
    const provider = new AzureAppServiceDiscoveryProvider(stubResourceLister(resources));
    const runner = new MeshDiscoveryRunner([provider]);

    const registry = await runner.discoverAsync(new MeshDiscoveryFilter());

    expect(registry.services.map((s) => s.name)).toEqual(['orders']);
  });
});

describe('Azure Functions mesh — interrogation + aggregation (real local HTTP, no cloud account)', () => {
  const runningHosts: RunningFunctionHost[] = [];

  afterEach(async () => {
    await Promise.all(runningHosts.map((h) => h.close()));
    runningHosts.length = 0;
  });

  async function startAllServices(): Promise<Record<string, RunningFunctionHost>> {
    // Only each service's HTTP startup matters for interrogation (the mesh only ever talks to
    // /benzene/spec + /benzene/health); each service's other trigger(s) live on their own separate hosts
    // (see src/startUps.ts's file header) and are exercised directly in the "each transport genuinely
    // delivers" block below.
    const hosts: Record<string, RunningFunctionHost> = {
      orders: await listenHttpFunction(hostFor(OrdersStartUp).httpFunction),
      payments: await listenHttpFunction(hostFor(PaymentsHttpStartUp).httpFunction),
      shipping: await listenHttpFunction(hostFor(ShippingHttpStartUp).httpFunction),
      inventory: await listenHttpFunction(hostFor(InventoryHttpStartUp).httpFunction),
      notifications: await listenHttpFunction(hostFor(NotificationsHttpStartUp).httpFunction),
      analytics: await listenHttpFunction(hostFor(AnalyticsHttpStartUp).httpFunction),
    };
    runningHosts.push(...Object.values(hosts));
    return hosts;
  }

  function registryFrom(hosts: Record<string, RunningFunctionHost>): MeshServiceRegistry {
    return new MeshServiceRegistry(
      Object.entries(hosts).map(
        ([name, h]) => new MeshServiceRegistryEntry(name, `${h.url}/benzene/spec?type=benzene`, `${h.url}/benzene/health`),
      ),
    );
  }

  /** The mesh's real `MeshAggregationService`, wired against a fake single-provider discovery runner that
   *  hands back the already-known local registry — proving the SAME production aggregation code this
   *  example's mesh Function runs, without needing a TLS-terminating server (see the file header). */
  function aggregationServiceFor(registry: MeshServiceRegistry, rootDirectory: string): MeshAggregationService {
    const provider: IMeshDiscoveryProvider = {
      key: 'test',
      discoverAsync: () => Promise.resolve(registry.services),
    };
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const aggregator = new MeshAggregator([new HttpMeshServiceSource()], store);
    return new MeshAggregationService(new MeshDiscoveryRunner([provider]), store, aggregator);
  }

  let rootDirectory: string;
  beforeEach(() => {
    rootDirectory = mkdtempSync(join(tmpdir(), 'benzene-azure-functions-mesh-'));
  });
  afterEach(() => {
    rmSync(rootDirectory, { recursive: true, force: true });
  });

  it('interrogates each service over real HTTP and reports every service healthy', async () => {
    const hosts = await startAllServices();
    const registry = registryFrom(hosts);
    const service = aggregationServiceFor(registry, rootDirectory);

    const discovered = await service.runAsync();
    expect(discovered).toBe(6);

    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const manifest = JSON.parse((await store.tryReadAsync('manifest.json'))!) as {
      services: { name: string; status: string; transports: string[] }[];
    };
    expect(manifest.services).toHaveLength(6);
    expect(manifest.services.every((s) => s.status === MeshServiceStatus.healthy)).toBe(true);

    const payments = manifest.services.find((s) => s.name === 'payments')!;
    expect([...payments.transports].sort()).toEqual(['http', 'service-bus']);
  });

  it('catalogs the cross-service topics with producers and consumers', async () => {
    const hosts = await startAllServices();
    const registry = registryFrom(hosts);
    const service = aggregationServiceFor(registry, rootDirectory);
    await service.runAsync();

    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const catalog = JSON.parse((await store.tryReadAsync('topics.json'))!) as {
      topics: { topic: string; consumers: { service: string }[]; producers: { service: string }[] }[];
    };
    const byTopic = (t: string) => catalog.topics.find((x) => x.topic === t)!;
    const names = (xs: { service: string }[]) => xs.map((x) => x.service).sort();

    expect(names(byTopic('payment:take').producers)).toEqual(['orders']);
    expect(names(byTopic('payment:take').consumers)).toEqual(['payments']);

    expect(names(byTopic('order:placed').producers)).toEqual(['orders']);
    expect(names(byTopic('order:placed').consumers)).toEqual(['inventory', 'notifications']);

    expect(names(byTopic('shipment:book').producers)).toEqual(['payments']);
    expect(names(byTopic('shipment:book').consumers)).toEqual(['shipping']);

    expect(names(byTopic('payment:captured').producers)).toEqual(['payments']);
    expect(names(byTopic('payment:captured').consumers)).toEqual(['analytics', 'notifications']);

    expect(names(byTopic('shipment:dispatched').producers)).toEqual(['shipping']);
    expect(names(byTopic('shipment:dispatched').consumers)).toEqual(['analytics', 'inventory', 'notifications']);
  });

  it('derives the structural topology (9 producer -> consumer edges) from the specs', async () => {
    const hosts = await startAllServices();
    const registry = registryFrom(hosts);
    const service = aggregationServiceFor(registry, rootDirectory);
    await service.runAsync();

    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const topology = JSON.parse((await store.tryReadAsync('topology.json'))!) as {
      edges: { client: string; server: string; source: string }[];
    };
    const edge = (client: string, server: string) => topology.edges.some((e) => e.client === client && e.server === server);

    expect(topology.edges).toHaveLength(9);
    expect(edge('orders', 'payments')).toBe(true);
    expect(edge('orders', 'inventory')).toBe(true);
    expect(edge('orders', 'notifications')).toBe(true);
    expect(edge('payments', 'shipping')).toBe(true);
    expect(edge('payments', 'notifications')).toBe(true);
    expect(edge('payments', 'analytics')).toBe(true);
    expect(edge('shipping', 'inventory')).toBe(true);
    expect(edge('shipping', 'notifications')).toBe(true);
    expect(edge('shipping', 'analytics')).toBe(true);
    expect(topology.edges.every((e) => e.source === 'structural')).toBe(true);
  });

  it('a service genuinely serves the Cloud Service Profile over real local HTTP', async () => {
    const hosts = await startAllServices();

    expect((await fetch(`${hosts['orders']!.url}/benzene/health`)).status).toBe(200);
    expect((await fetch(`${hosts['orders']!.url}/benzene/spec?type=benzene`)).status).toBe(200);

    const invokeRes = await fetch(`${hosts['orders']!.url}/benzene/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic: 'benzene:healthcheck', headers: {}, body: '' }),
    });
    expect(invokeRes.status).toBe(200);
    expect(await invokeRes.text()).toContain('isHealthy');

    // orders also exposes its own domain route on the SAME catch-all HTTP trigger.
    const orderRes = await fetch(`${hosts['orders']!.url}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customerId: 'c-1', sku: 'espresso', quantity: 2 }),
    });
    expect(orderRes.status).toBe(201);
    const order = (await orderRes.json()) as { orderId: string; status: string };
    expect(order.status).toBe('created');
  });
});

describe('Azure Functions mesh — each transport genuinely delivers (real trigger payloads)', () => {
  afterAll(() => {
    analyticsReceipts.length = 0;
    inventoryReceipts.length = 0;
    notificationsReceipts.length = 0;
  });

  it('the Service Bus queue trigger routes payment:take by the "topic" application property', async () => {
    const host = hostFor(PaymentsServiceBusStartUp);
    const message = asAzureServiceBusMessage(messageBuilder('payment:take', { orderId: 'o-1', amount: 30, currency: 'GBP' }));

    // TakePaymentHandler runs and returns without throwing — proving the Service Bus trigger routed the
    // message to it by the "topic" application property. Its own onward Service Bus/Event Grid sends are
    // best-effort (wrapped in try/catch — see domain/payments.ts) precisely so that a real handler run,
    // like this one with no live connection configured, still completes instead of failing the trigger.
    await expect(host.serviceBusFunction([message], new InvocationContext())).resolves.toBeUndefined();
  });

  it('the Event Hub trigger routes order:placed by its envelope body (the framework-gap workaround)', async () => {
    const inventoryHost = hostFor(InventoryEventHubStartUp);
    const notificationsHost = hostFor(NotificationsEventHubStartUp);
    const event = asEventHubBenzeneMessage(messageBuilder('order:placed', { orderId: 'o-2', sku: 'espresso', quantity: 1 }));

    await inventoryHost.eventHubFunction([event], new InvocationContext());
    await notificationsHost.eventHubFunction([event], new InvocationContext());

    expect(inventoryReceipts).toContain('order:placed:o-2');
    expect(notificationsReceipts).toContain('order:placed:o-2');
  });

  it('the Event Grid trigger routes payment:captured and shipment:dispatched by eventType (CloudEvents 1.0)', async () => {
    const notificationsHost = hostFor(NotificationsEventGridStartUp);
    const analyticsHost = hostFor(AnalyticsEventGridStartUp);

    const cloudEvent = (type: string, data: unknown): string =>
      JSON.stringify({ specversion: '1.0', id: 'evt-1', source: 'payments-api', type, data });

    await handleEventGridEvent(notificationsHost.app, cloudEvent('payment:captured', { orderId: 'o-3', amount: 30, currency: 'GBP' }));
    await handleEventGridEvent(analyticsHost.app, cloudEvent('payment:captured', { orderId: 'o-3', amount: 30, currency: 'GBP' }));
    await handleEventGridEvent(notificationsHost.app, cloudEvent('shipment:dispatched', { orderId: 'o-3', carrier: 'DPD' }));
    await handleEventGridEvent(analyticsHost.app, cloudEvent('shipment:dispatched', { orderId: 'o-3', carrier: 'DPD' }));

    expect(notificationsReceipts).toContain('payment:captured:o-3');
    expect(analyticsReceipts).toContain('payment:captured:o-3');
    expect(notificationsReceipts).toContain('shipment:dispatched:o-3');
    expect(analyticsReceipts).toContain('shipment:dispatched:o-3');
  });
});
