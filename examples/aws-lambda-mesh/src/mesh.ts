/**
 * The mesh Lambda, mirroring the .NET AwsMesh `Mesh/` project: on each run it **discovers** the
 * benzene-tagged service Lambdas, **interrogates** each by a synchronous Lambda invoke on the reserved
 * `benzene:spec`/`benzene:healthcheck` topics, and **aggregates** the answers into the catalog artifacts (`manifest.json`,
 * `services/*.json`, `topics.json`, `topology.json`, …) written to an artifact store.
 *
 * Here the store is a `FileSystemMeshArtifactStore` (the .NET example writes to S3 via
 * `Benzene.Mesh.Aws.S3`); the discovery + interrogation wiring is otherwise identical.
 */
import { Handler } from 'aws-lambda';
import {
  FileSystemMeshArtifactStore,
  IMeshArtifactStore,
  MeshAggregator,
} from '@benzenejs/mesh-aggregator';
import { MeshDiscoveryFilter, MeshDiscoveryRunner, MeshManifest, MeshServiceRegistry } from '@benzenejs/mesh-contracts';
import { AwsLambdaDiscoveryProvider } from '@benzenejs/mesh-discovery-aws';
import { LambdaMeshServiceSource } from '@benzenejs/mesh-aws-lambda';
import { discoveryLambdaClient, inMemoryLambdaClient } from './localAwsEnvironment';

/** The outcome of one aggregation pass: the discovered registry, the manifest, and the artifact store. */
export interface MeshRunResult {
  readonly registry: MeshServiceRegistry;
  readonly manifest: MeshManifest;
  readonly store: IMeshArtifactStore;
}

/**
 * Runs one full mesh aggregation pass against the given in-process service Lambdas, writing the catalog to
 * `rootDirectory`. This is the body of the .NET `MeshAggregateHandler`: discover → (write registry +) run the
 * aggregator.
 */
export async function runMeshAggregation(
  services: Record<string, Handler>,
  rootDirectory: string,
): Promise<MeshRunResult> {
  // 1. Discover the benzene-tagged Lambdas (ListFunctions + ListTags), producing aws-lambda-invoke entries.
  const discovery = new AwsLambdaDiscoveryProvider(discoveryLambdaClient(Object.keys(services)));
  const runner = new MeshDiscoveryRunner([discovery]);
  const registry = await runner.discoverAsync(new MeshDiscoveryFilter());

  // 2. Interrogate each discovered Lambda by synchronous invoke (benzene:spec/benzene:healthcheck) and aggregate the catalog.
  const store = new FileSystemMeshArtifactStore(rootDirectory);
  const source = new LambdaMeshServiceSource(() => inMemoryLambdaClient(services));
  const aggregator = new MeshAggregator([source], store);

  const manifest = await aggregator.runOnceAsync(registry);
  return { registry, manifest, store };
}
