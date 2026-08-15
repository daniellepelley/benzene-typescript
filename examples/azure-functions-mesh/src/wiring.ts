/**
 * The wiring every AzureFunctionsMesh Cloud Service shares — the TypeScript port of .NET's
 * `Shared/MeshServiceWiring.cs`. Each of the six services is its own Azure Function App, so each gets its
 * own `BenzeneStartUp` (see `startUps.ts`) built from these helpers: the baseline service registration
 * (`configureCloudService`), the HTTP Cloud Service Profile wiring (`wireHttpCloudService`), a trivial
 * `self` health check, and lazy Service Bus/Event Hub/Event Grid client factories reading their target
 * from an environment variable — so a service still starts locally with no messaging configured (a send
 * just fails and is caught by the domain handler's own best-effort `try`, mirrored here by
 * `IBenzeneMessageSender.sendAsync` swallowing nothing — see `withHandlers`' callers for the try/catch).
 */
import { Constructor, IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { ITransportsInfo, TransportNames } from '@benzenejs/abstractions-message-handlers';
import { HealthCheckResult, IHealthCheck, IHealthCheckResult } from '@benzenejs/health-checks-core';
import { InlineHealthCheck } from '@benzenejs/health-checks';
import { addBenzene, TransportInfo, TransportsInfo } from '@benzenejs/core-message-handlers';
import { useAzureFunctions } from '@benzenejs/azure-function-core';
import { useAzureHttp } from '@benzenejs/azure-function-http';
import { useBenzeneCloudService } from '@benzenejs/cloud-service';
import { ServiceBusClient, ServiceBusSender } from '@azure/service-bus';
import { EventHubProducerClient } from '@azure/event-hubs';
import { EventGridPublisherClient, AzureKeyCredential } from '@azure/eventgrid';

/** A trivial always-healthy check so a service is Cloud Service Profile-conformant (profile R3). */
export function selfHealthCheck(service: string): IHealthCheck {
  return new InlineHealthCheck('self', (): Promise<IHealthCheckResult> =>
    Promise.resolve(HealthCheckResult.createInstance(true, 'self', { service })),
  );
}

/**
 * Registers the baseline Benzene service graph: `addBenzene` plus anything else `configureBenzene` adds
 * (response-event declarations, outbound routing, lazy SDK clients). Called from each service's
 * `configureServices`.
 */
export function configureCloudService(
  services: IBenzeneServiceContainer,
  configureBenzene?: (services: IBenzeneServiceContainer) => void,
): void {
  addBenzene(services);
  configureBenzene?.(services);
}

/**
 * Wires the HTTP Cloud Service Profile (the mesh's interrogation surface) at the default standard paths
 * — `/benzene/spec`, `/benzene/health`, `/benzene/invoke` — plus any of the service's own `@httpEndpoint`
 * routes on `handlerTypes` (e.g. orders' `POST /orders`). A Cloud Service serves only JSON; the browsable
 * Spec UI is served by the mesh, not the service (mirrors .NET's `MeshServiceWiring.Configure`).
 *
 * `extraTransports` declares the OTHER transports this service listens on (e.g. `['service-bus']` for
 * payments), so the spec's `transports` field is complete even though — under this port's one-container-
 * per-trigger split (see `startUps.ts`'s file header) — the HTTP container the mesh interrogates has no
 * visibility into the sibling Service Bus/Event Hub/Event Grid containers. Mirrors `aws-lambda-mesh`'s own
 * manual `TransportsInfo` declaration for exactly the same reason (a multi-route composite can't
 * auto-aggregate transports across routes either).
 */
export function wireHttpCloudService(
  app: IBenzeneApplicationBuilder,
  serviceName: string,
  handlerTypes: Constructor<unknown>[],
  healthChecks: IHealthCheck[],
  extraTransports: string[] = [],
): void {
  useAzureFunctions(app, (az) => {
    useAzureHttp(az, (http) => {
      http.register((x) => {
        x.addSingletonInstance(
          ITransportsInfo,
          new TransportsInfo([TransportNames.Http, ...extraTransports].map((t) => new TransportInfo(t))),
        );
      });
      useBenzeneCloudService(http, `${serviceName}-api`, (cloud) =>
        cloud
          .withServiceVersion('1.0.0')
          .withInstanceId(serviceName)
          .withPlacement('azure-functions', process.env['REGION_NAME'] ?? 'local')
          .withHealthChecks(...healthChecks)
          .withHandlers(...handlerTypes),
      );
    });
  });
}

/**
 * Wraps a real-client factory in a lazy `Proxy`: the SDK client is constructed on first actual use (the
 * first property/method access), not when this function returns. This matters because `route(...)`'s
 * `configure` callback runs SYNCHRONOUSLY inside `addOutboundRouting` (during `configureServices`, at
 * cold start) — and each Azure SDK client's constructor THROWS synchronously on an empty/malformed
 * connection string. Deferring construction to first send is what lets a service still start locally with
 * no messaging configured (the send itself then fails, caught by the domain handler's own `try`/`catch`
 * around each `sendAsync` call — see `src/domain/*.ts`), matching .NET's lazy `AddSingleton(_ => ...)`
 * DI registration, which only ever runs on first resolution, not at startup.
 */
function lazy<T extends object>(factory: () => T): T {
  let real: T | undefined;
  const resolve = (): T => (real ??= factory());
  return new Proxy({} as T, {
    get(_target, prop) {
      const target = resolve();
      const value = Reflect.get(target as object, prop, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** Builds a lazy `ServiceBusSender` for `queueName` off the `ServiceBusConnection` app setting. */
export function serviceBusSender(queueName: string): ServiceBusSender {
  return lazy(() => {
    const connection = process.env['ServiceBusConnection'] ?? '';
    return new ServiceBusClient(connection).createSender(queueName);
  });
}

/** Builds a lazy `EventHubProducerClient` for `eventHubName` off the `EventHubConnection` app setting. */
export function eventHubProducer(eventHubName: string): EventHubProducerClient {
  return lazy(() => {
    const connection = process.env['EventHubConnection'] ?? '';
    return new EventHubProducerClient(connection, eventHubName);
  });
}

/** Builds a lazy `EventGridPublisherClient` (CloudEvents 1.0 schema) off the `EventGridEndpoint` / `EventGridKey` app settings. */
export function eventGridPublisher(): EventGridPublisherClient<'CloudEvent'> {
  return lazy(() => {
    const endpoint = process.env['EventGridEndpoint'] ?? 'https://localhost';
    const key = process.env['EventGridKey'] ?? '';
    return new EventGridPublisherClient(endpoint, 'CloudEvent', new AzureKeyCredential(key));
  });
}
