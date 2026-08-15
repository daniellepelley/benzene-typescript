/**
 * The mesh service, hosted as an Express app inside a container — the TypeScript port of .NET
 * K8sMesh's `Mesh/Startup.cs`. It discovers the benzene-labelled Kubernetes Services (via the
 * Kubernetes API — `@benzenejs/mesh-discovery-kubernetes`, already real, just unwired into any example
 * until now), writes the discovered registry, interrogates each over plain in-cluster HTTP, and serves
 * the Mesh UI + catalog artifacts. It also hosts a live `@benzenejs/mesh-collector` at `/benzene/invoke`
 * that each Cloud Service reports to (`MESH_COLLECTOR_ENVELOPE_URL`), and a `POST /mesh/refresh`
 * endpoint that triggers an immediate discovery pass.
 *
 * Design choice — a LIVE `@benzenejs/mesh-ui`, not a static catalog page: `examples/aws-lambda-mesh`
 * serves its own static `web/index.html` viewer instead of `@benzenejs/mesh-ui` because a Lambda mesh
 * function scales to zero between invocations — there is no always-on process to serve a live page from,
 * so a static file next to the published artifacts is the only sensible host. Kubernetes has exactly
 * the always-on process a Lambda deployment lacks (this same Express app, running continuously), so this
 * example serves `@benzenejs/mesh-ui` live instead, matching .NET K8sMesh's own choice
 * (`UseMeshUi`/`UseMeshSpecUi`) rather than aws-lambda-mesh's workaround. `manifest.json` and the rest of
 * the aggregator's published artifacts are additionally served as plain static files (see below), which
 * also means the identical `mesh-ui.html` page still works unmodified if ever pointed at a plain static
 * file host instead of this pipeline — the primary deployment target `@benzenejs/mesh-ui`'s own docs
 * describe.
 */
import express, { type Express } from 'express';
import { IBenzeneServiceContainer, VoidResult } from '@benzenejs/abstractions';
import { IMessageHandlerDefinition } from '@benzenejs/abstractions-message-handlers';
import { MessageHandlerDefinition, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { benzene } from '@benzenejs/express';
import { HttpEndpointDefinition, IHttpEndpointDefinition, useBenzeneMessage } from '@benzenejs/http';
import { addMeshAggregator, MeshAggregator, IMeshArtifactStore } from '@benzenejs/mesh-aggregator';
import { addMeshKubernetesDiscovery } from '@benzenejs/mesh-discovery-kubernetes';
import { MeshDiscoveryRunner, MeshServiceRegistry } from '@benzenejs/mesh-contracts';
import { useMeshSpecUi, useMeshUi } from '@benzenejs/mesh-ui';
import { addMeshCollector } from './meshCollector';
import { MeshAggregationService, MeshRefreshHandler, MeshRefreshResult } from './meshAggregation';

/** The mesh's live spec collector — services push register/heartbeat/traces here. */
const COLLECTOR_ENVELOPE_PATH = '/benzene/invoke';

/** Where `useMeshUi`/`useMeshSpecUi` serve the catalog viewer and the per-service Spec Explorer. */
const MESH_UI_PATH = '/mesh-ui';
const MESH_SPEC_UI_PATH = '/mesh-spec-ui.html';

export interface MeshApp {
  readonly app: Express;
  /**
   * The exact `MeshAggregationService` singleton `POST /mesh/refresh` resolves — shared with the
   * background loop (`meshIndex.ts`) so there is one `MeshAggregator`/`MeshDiscoveryRunner` pair
   * driving both the on-demand and the periodic pass, not two independent ones racing each other.
   */
  readonly aggregation: MeshAggregationService;
}

export function createMeshApp(artifactDir: string): MeshApp {
  const app = express();

  // The aggregator's published catalog (manifest.json, services/*.json, topics.json, topology.json,
  // asyncapi.json, registry.json) served as plain static files, exactly as a mesh-ui.html deployment
  // would find them alongside it on any static file host — see the module comment. Mounted ahead of
  // `benzene()` so these never fall through into the Benzene pipeline at all.
  app.use(express.static(artifactDir));

  // Built explicitly (rather than left to benzene()'s own default) so the mesh's background aggregation
  // loop can resolve the same MeshAggregationService singleton this container wires below — see MeshApp.
  const container = new DefaultBenzeneServiceContainer();

  app.use(
    benzene((pipeline) => {
      // Same Express strangler-gate gap as serviceApp.ts (see its comment): the collector's envelope
      // endpoint and the two Mesh UI pages each serve a fixed path without registering an
      // IHttpEndpointDefinition (by design — none of the three is wired into the endpoint-definition
      // system), so each needs an explicit route registered for Express to hand matching requests to
      // the Benzene pipeline at all.
      pipeline.register((container) => {
        container.addSingletonInstance(
          IHttpEndpointDefinition,
          HttpEndpointDefinition.createInstance('POST', COLLECTOR_ENVELOPE_PATH, 'benzene:collector'),
        );
        container.addSingletonInstance(
          IHttpEndpointDefinition,
          HttpEndpointDefinition.createInstance('GET', MESH_UI_PATH, 'benzene:mesh-ui'),
        );
        container.addSingletonInstance(
          IHttpEndpointDefinition,
          HttpEndpointDefinition.createInstance('GET', MESH_SPEC_UI_PATH, 'benzene:mesh-spec-ui'),
        );
      });

      pipeline.register((container) => {
        // Discovery starts with an empty registry — discovery replaces it at runtime, on every pass.
        addMeshAggregator(container, new MeshServiceRegistry([]), artifactDir);

        // addMeshKubernetesDiscovery loads the in-cluster Kubernetes config (mounted ServiceAccount
        // token + CA cert) eagerly, at registration time — appropriate for what this function is FOR
        // (a mesh pod running inside a real cluster, per its own doc comment), but it means calling it
        // outside a cluster throws synchronously and would otherwise take the whole process down before
        // it can serve anything. Falling back to a MeshDiscoveryRunner with no providers keeps the HTTP
        // surface (Mesh UI, `/mesh/refresh` answering `{"discovered":0}`) usable for a local
        // Express-wiring smoke test without a cluster — matching the framework's own "an unreachable
        // dependency degrades a feature, it does not fail the process" posture elsewhere (e.g. an
        // unreachable mesh collector never fails a Cloud Service). Inside a real Deployment (kind/EKS)
        // this always succeeds and real discovery runs.
        try {
          addMeshKubernetesDiscovery(container);
        } catch (err) {
          console.warn('mesh: no in-cluster Kubernetes config; falling back to no discovery providers.', err);
          container.addSingletonFactory(MeshDiscoveryRunner, () => new MeshDiscoveryRunner([]));
        }

        registerMeshRefresh(container);
      });

      // The catalog viewer (what services declare) enriched in-page with the live Fleet plane (what's
      // actually running), polled from the collector below.
      useMeshUi(pipeline, MESH_UI_PATH, 'manifest.json', COLLECTOR_ENVELOPE_PATH);
      // The mesh-hosted per-service Spec UI mesh-ui.html's "benzene:spec" link opens.
      useMeshSpecUi(pipeline, MESH_SPEC_UI_PATH, 'manifest.json');

      // The live spec collector behind its own wire-envelope endpoint: services push register/
      // heartbeat/trace here (MESH_COLLECTOR_ENVELOPE_URL), and the Mesh UI's Fleet plane queries it
      // (mesh:query:fleet etc). Its own inner pipeline routes only the collector's reserved topics, over
      // the singleton MeshCollectorStore this envelope container owns.
      useBenzeneMessage(pipeline, { path: COLLECTOR_ENVELOPE_PATH }, (envelope) => {
        envelope.register((container) => addMeshCollector(container));
        useMessageHandlers(envelope);
      });

      // Terminal message router for the outer pipeline: mesh:aggregate/mesh:report/mesh:annotations
      // (registered by addMeshAggregator above) plus mesh:refresh (registered by registerMeshRefresh).
      useMessageHandlers(pipeline);
    }, { container }),
  );

  // Registration above ran synchronously inside benzene(), so the container is fully populated now.
  // MeshAggregationService is a singleton (addSingletonFactory), so this is the exact same instance
  // POST /mesh/refresh resolves per-request — see MeshApp's doc comment.
  const scope = container.createServiceResolverFactory().createScope();
  const aggregation = scope.getService(MeshAggregationService);

  return { app, aggregation };
}

/** Registers `MeshRefreshHandler` on `mesh:refresh` / `POST /mesh/refresh`, mirroring `addMeshAggregator`'s
 *  own registration pattern for its three handlers (no `@message`/`@httpEndpoint` decorators involved). */
function registerMeshRefresh(container: IBenzeneServiceContainer): void {
  container.addSingletonFactory(
    MeshAggregationService,
    (resolver) =>
      new MeshAggregationService(
        resolver.getService(MeshDiscoveryRunner),
        resolver.getService(IMeshArtifactStore),
        resolver.getService(MeshAggregator),
      ),
  );
  container.addScopedFactory(
    MeshRefreshHandler,
    (resolver) => new MeshRefreshHandler(resolver.getService(MeshAggregationService)),
  );
  container.addSingletonInstance(
    IMessageHandlerDefinition,
    MessageHandlerDefinition.createInstance('mesh:refresh', '', VoidResult, MeshRefreshResult, MeshRefreshHandler),
  );
  container.addSingletonInstance(
    IHttpEndpointDefinition,
    HttpEndpointDefinition.createInstance('POST', '/mesh/refresh', 'mesh:refresh'),
  );
}
