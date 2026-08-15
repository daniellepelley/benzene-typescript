/**
 * One Benzene Cloud Service, hosted as an Express app inside a container — the TypeScript port of .NET
 * K8sMesh's `Service/Startup.cs`. The domain it serves (orders/payments/shipping) is chosen at startup
 * by the `MESH_SERVICE` env var (see `index.ts`), so a single image is deployed three times as three
 * labelled Kubernetes Services. Exposes the Cloud Service Profile over HTTP — `/benzene/spec`,
 * `/benzene/health`, `/benzene/invoke`, `/benzene/spec-ui` — plus the K8sMesh-specific chain-ingress
 * endpoint `POST /benzene-message`, which is exactly how the mesh interrogates a service and how a
 * service chains to the next (plain in-cluster HTTP).
 */
import express, { type Express } from 'express';
import { IBenzeneMessageClient } from '@benzenejs/clients';
import { IMiddlewarePipelineBuilder } from '@benzenejs/abstractions-middleware';
import { BenzeneMessageContext } from '@benzenejs/core-messages';
import { benzene } from '@benzenejs/express';
import { HealthCheckResult } from '@benzenejs/health-checks-core';
import { InlineHealthCheck } from '@benzenejs/health-checks';
import { HttpEndpointDefinition, IHttpEndpointDefinition, useBenzeneMessage } from '@benzenejs/http';
import { useSpecUi } from '@benzenejs/spec-ui';
import { useBenzeneCloudService } from '@benzenejs/cloud-service';
import { useMessageHandlers } from '@benzenejs/core-message-handlers';
import { handlersFor } from './domain';
import { HttpBenzeneMessageClient, NullBenzeneMessageClient } from './httpBenzeneMessageClient';

/** The chain-ingress endpoint every service exposes (K8sMesh README's "one route serves every topic"). */
const CHAIN_ENDPOINT_PATH = '/benzene-message';

/** The Cloud Service Profile's wire-envelope endpoint (profile R4). Matches `CloudServicePaths.invoke`. */
const INVOKE_ENDPOINT_PATH = '/benzene/invoke';

/** Where `useSpecUi` serves the Spec Explorer page. */
const SPEC_UI_PATH = '/benzene/spec-ui';

export function createServiceApp(serviceName: string): Express {
  const downstreamUrl = process.env['DOWNSTREAM_MSG_URL'];
  const collectorUrl = process.env['MESH_COLLECTOR_ENVELOPE_URL'];
  const handlerTypes = handlersFor(serviceName);

  // Egress half of the chain: HttpBenzeneMessageClient posts the next hop's envelope over in-cluster
  // DNS. A NullBenzeneMessageClient stands in when no downstream is wired (the terminal shipping
  // service, or a standalone run), so the chaining handlers still resolve. One instance is shared by
  // both envelope pipelines below (`/benzene-message` and the cloud service's own `/benzene/invoke`) —
  // each gets its own DI container (see `registerClient`'s comment), but the same client instance.
  const client: IBenzeneMessageClient = downstreamUrl
    ? new HttpBenzeneMessageClient(downstreamUrl)
    : new NullBenzeneMessageClient();

  const app = express();

  app.use(
    benzene((pipeline) => {
      // @benzenejs/express's `benzene()` middleware only hands a request to the Benzene pipeline when a
      // registered `IHttpEndpointDefinition` matches its method+path (the strangler-fig gate) — routes
      // normally come from `@httpEndpoint`-decorated handlers. Three surfaces below serve a fixed path
      // without going through that mechanism, by design (each is documented as a "secondary
      // convenience" whose primary deployment target is a plain static/non-Benzene host, so it isn't
      // wired into the endpoint-definition system): `useBenzeneMessage`'s raw envelope endpoint,
      // `useBenzeneCloudService`'s own `/benzene/invoke`, and `useSpecUi`'s page. Under Express
      // specifically they would 404 before ever reaching their middleware. Registering a definition for
      // each — the topic value is a label only, discarded once the gate passes — closes that gap without
      // touching `@benzenejs/express`/`@benzenejs/http`/`@benzenejs/cloud-service`/`@benzenejs/spec-ui`
      // (see the task report).
      pipeline.register((container) => {
        container.addSingletonInstance(
          IHttpEndpointDefinition,
          HttpEndpointDefinition.createInstance('POST', CHAIN_ENDPOINT_PATH, 'benzene:chain-ingress'),
        );
        container.addSingletonInstance(
          IHttpEndpointDefinition,
          HttpEndpointDefinition.createInstance('POST', INVOKE_ENDPOINT_PATH, 'benzene:invoke'),
        );
        container.addSingletonInstance(
          IHttpEndpointDefinition,
          HttpEndpointDefinition.createInstance('GET', SPEC_UI_PATH, 'benzene:spec-ui'),
        );

        // The domain handler is also resolved on THIS (outer) container for its own @httpEndpoint route
        // (e.g. POST /orders) — a separate resolution path from either envelope pipeline below, each of
        // which gets its own DI container (see registerClient's comment) — so it needs the client here
        // too, not just inside the two envelope pipelines.
        container.addSingletonFactory(IBenzeneMessageClient, () => client);
      });

      // Ingress half of the orders -> payments -> shipping chain: a POST of a { topic, headers, body }
      // envelope here is routed to this service's handler by the envelope's topic — one endpoint serves
      // every topic, exactly like a queue/Lambda-invoke path would. This is the same server-side
      // contract the Cloud Service Profile's own invoke endpoint below exposes, just addressed
      // separately so a downstream client can reach it without knowing about the profile.
      useBenzeneMessage(pipeline, { path: CHAIN_ENDPOINT_PATH }, (envelope) => {
        registerClient(envelope, client);
        useMessageHandlers(envelope, ...handlerTypes);
      });

      useSpecUi(pipeline, SPEC_UI_PATH, '/benzene/spec?type=benzene');

      useBenzeneCloudService(pipeline, `${serviceName}-api`, (cloud) => {
        cloud
          .withServiceVersion('1.0.0')
          .withInstanceId(serviceName)
          .withPlacement('kubernetes', 'in-cluster')
          .withHealthChecks(
            new InlineHealthCheck('self', () =>
              Promise.resolve(HealthCheckResult.createInstance(true, 'self', { service: serviceName })),
            ),
          )
          .withHandlers(...handlerTypes)
          // The envelope pipeline gets its own DI container (TypeScript generic-erasure isolation — see
          // useBenzeneMessage's own remarks), so the client needs registering here too, not just above.
          .withMiddleware((envelope) => registerClient(envelope, client));

        // Report to the mesh's collector (register + heartbeat + traces) when one is reachable, so the
        // Mesh UI's live Fleet plane populates. Best-effort — an unreachable collector never fails the
        // service, it just leaves that service's live feed empty.
        if (collectorUrl !== undefined && collectorUrl.trim() !== '') {
          cloud.withCollector(collectorUrl);
        }
      });
    }),
  );

  return app;
}

function registerClient(
  envelope: IMiddlewarePipelineBuilder<BenzeneMessageContext>,
  client: IBenzeneMessageClient,
): void {
  envelope.register((container) => {
    container.addSingletonFactory(IBenzeneMessageClient, () => client);
  });
}
