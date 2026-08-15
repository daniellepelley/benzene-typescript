/**
 * The mesh — hosted purely as Azure Functions (the TypeScript port of .NET's `Mesh/StartUp.cs`). TWO
 * `BenzeneStartUp`s, each with its own container/host (see `src/startUps.ts`'s file header for why one
 * container per trigger is required under TypeScript's generic erasure — the same reasoning applies here
 * between the HTTP and Timer triggers): `MeshHttpStartUp` serves the Mesh UI (`/mesh-ui`), the
 * mesh-hosted per-service Spec UI (`/mesh-spec-ui.html`), the catalog artifacts read back from Blob
 * Storage, and `POST /mesh/refresh`; `MeshTimerStartUp` runs the discovery + aggregation pass on a
 * schedule (a Consumption Function has no always-on thread for a background loop).
 *
 * Discovery finds the six benzene-tagged Function Apps via Azure Resource Manager (the mesh's managed
 * identity), and `HttpMeshServiceSource` (the generic HTTP interrogation source `@benzenejs/mesh-
 * aggregator` already ships — no Azure-specific interrogation package needed, since discovery emits plain
 * HTTP registry entries) interrogates each over HTTPS.
 *
 * CONSEQUENCE OF THE SPLIT: `MeshAggregationService`'s single-flight gate (its `runAsync`, see
 * `meshAggregation.ts`) now only serializes calls WITHIN one container — the HTTP container's `POST
 * /mesh/refresh` and the Timer container's scheduled pass are separate `MeshAggregationService` instances
 * (each still individually single-flight), so a refresh and a tick can in principle race and interleave
 * their writes to Blob Storage. .NET avoids this because its ONE container safely hosts both triggers (no
 * generic erasure), so its ONE semaphore covers both. This is a narrow, documented gap — not a
 * correctness issue for the mesh's core promise, and any interleaving self-heals on the next pass.
 */
import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { IBenzeneServiceContainer, VoidResult } from '@benzenejs/abstractions';
import { IMessageHandlerDefinition } from '@benzenejs/abstractions-message-handlers';
import { BenzeneStartUp, IBenzeneApplicationBuilder, IMiddlewarePipelineBuilder } from '@benzenejs/abstractions-middleware';
import { MessageHandlerDefinition, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { HttpEndpointDefinition, IHttpEndpointDefinition } from '@benzenejs/http';
import { azureHttpRequestPath, AzureHttpContext, ensureResponseExists } from '@benzenejs/azure-function-http';
import { useAzureFunctions } from '@benzenejs/azure-function-core';
import { useAzureHttp } from '@benzenejs/azure-function-http';
import { useTimerTrigger } from '@benzenejs/azure-function-timer';
import { addMeshAggregator, IMeshArtifactStore, MeshAggregator } from '@benzenejs/mesh-aggregator';
import { MeshDiscoveryRunner, MeshServiceRegistry } from '@benzenejs/mesh-contracts';
import { addMeshAzureDiscovery } from '@benzenejs/mesh-discovery-azure';
import { BlobMeshArtifactStore } from '@benzenejs/mesh-azure-blob';
import { useMeshSpecUi, useMeshUi } from '@benzenejs/mesh-ui';
import { MeshAggregationService, MeshRefreshHandler, MeshRefreshResult } from './meshAggregation';

const MESH_UI_PATH = '/mesh-ui';
const MESH_SPEC_UI_PATH = '/mesh-spec-ui.html';

/** Filenames the aggregator publishes — the only paths the artifact-serving middleware answers. */
const ARTIFACT_PATH = /^\/(manifest\.json|topics\.json|topology\.json|asyncapi\.json|registry\.json|services\/[\w.-]+\.json)$/;

/**
 * The mesh service graph both startups need: discovery + the artifact store + `MeshAggregationService`.
 * Called identically from both `MeshHttpStartUp` and `MeshTimerStartUp` (each gets its own container).
 */
function configureMeshServices(services: IBenzeneServiceContainer): void {
  const blobServiceUri = requiredEnv('MESH_BLOB_URI');
  const containerName = process.env['MESH_BLOB_CONTAINER'] ?? 'mesh';
  const prefix = process.env['MESH_BLOB_PREFIX'] ?? '';

  // Discovery starts with an empty registry — discovery replaces it at runtime, on every pass.
  addMeshAggregator(services, new MeshServiceRegistry([]), () => {
    const container = new BlobServiceClient(blobServiceUri, new DefaultAzureCredential()).getContainerClient(containerName);
    return new BlobMeshArtifactStore(container, prefix);
  });

  // Scope discovery to this deployment's subscription + resource group so a subscription-scoped Reader
  // identity doesn't discover every benzene-tagged site in the tenant.
  addMeshAzureDiscovery(services, process.env['MESH_SUBSCRIPTION_ID'], process.env['MESH_RESOURCE_GROUP']);

  services.addSingletonFactory(
    MeshAggregationService,
    (resolver) =>
      new MeshAggregationService(
        resolver.getService(MeshDiscoveryRunner),
        resolver.getService(IMeshArtifactStore),
        resolver.getService(MeshAggregator),
      ),
  );
}

/** The public HTTP surface: the Mesh UI, the mesh-hosted per-service Spec UI, the catalog artifacts read
 *  back from Blob Storage, and `POST /mesh/refresh`. */
export class MeshHttpStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    configureMeshServices(services);

    services.addScopedFactory(
      MeshRefreshHandler,
      (resolver) => new MeshRefreshHandler(resolver.getService(MeshAggregationService)),
    );
    services.addSingletonInstance(
      IMessageHandlerDefinition,
      MessageHandlerDefinition.createInstance('mesh:refresh', '', VoidResult, MeshRefreshResult, MeshRefreshHandler),
    );
    services.addSingletonInstance(
      IHttpEndpointDefinition,
      HttpEndpointDefinition.createInstance('POST', '/mesh/refresh', 'mesh:refresh'),
    );
  }

  configure(app: IBenzeneApplicationBuilder): void {
    useAzureFunctions(app, (az) =>
      useAzureHttp(az, (http) => {
        useMeshUi(http, MESH_UI_PATH, 'manifest.json');
        useMeshSpecUi(http, MESH_SPEC_UI_PATH, 'manifest.json');
        useArtifacts(http);
        useMessageHandlers(http);
      }),
    );
  }
}

/** The scheduled discovery + aggregation pass — the Consumption-plan replacement for an always-on
 *  BackgroundService. */
export class MeshTimerStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    configureMeshServices(services);
  }

  configure(app: IBenzeneApplicationBuilder): void {
    useAzureFunctions(app, (az) =>
      useTimerTrigger(az, (timer) =>
        timer.useFn('aggregate', async (_context, next, resolver) => {
          await resolver.getService(MeshAggregationService).runAsync();
          await next();
        }),
      ),
    );
  }
}

/**
 * Serves the aggregator's published catalog artifacts (`manifest.json`, `services/*.json`, `topics.json`,
 * `topology.json`, `asyncapi.json`, `registry.json`) straight from Blob Storage — the Azure counterpart of
 * a static-file host serving them alongside `mesh-ui.html` (see `examples/aws-lambda-mesh`'s S3 viewer and
 * `examples/k8s-mesh`'s `express.static`). A GET for one of these exact names reads it from the same
 * `IMeshArtifactStore` the aggregator writes to; anything else falls through to the rest of the pipeline.
 */
function useArtifacts(app: IMiddlewarePipelineBuilder<AzureHttpContext>): void {
  app.useFn('MeshArtifacts', async (context, next, resolver) => {
    const path = azureHttpRequestPath(context.httpRequest);
    if (context.httpRequest.method.toUpperCase() !== 'GET' || !ARTIFACT_PATH.test(path)) {
      await next();
      return;
    }

    const store = resolver.getService(IMeshArtifactStore);
    const content = await store.tryReadAsync(path.slice(1));
    if (content === undefined) {
      await next();
      return;
    }

    ensureResponseExists(context);
    context.response!.status = 200;
    (context.response!.headers as Record<string, string>)['content-type'] = 'application/json';
    context.response!.body = content;
  });
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is required (e.g. https://<account>.blob.core.windows.net).`);
  }
  return value;
}
