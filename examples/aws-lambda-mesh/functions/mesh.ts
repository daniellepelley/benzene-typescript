/**
 * Lambda entry point for the mesh function — the production counterpart of `../src/mesh.ts`
 * (`runMeshAggregation`), wired to real AWS instead of the in-memory stubs.
 *
 * On each invocation (an EventBridge schedule, or an on-demand invoke) it:
 *   1. **discovers** the benzene-tagged service Lambdas via a real `LambdaClient` (ListFunctions + ListTags);
 *   2. **persists** the discovered registry to S3 (`registry.json`) — the "discovery creates the config" seam;
 *   3. **interrogates** each discovered Lambda by real synchronous invoke on the reserved `spec`/`healthcheck`
 *      topics and **aggregates** the answers into the catalog artifacts, written to the same S3 bucket.
 *
 * Mirrors .NET's `Mesh/MeshAggregateHandler` (discover → write registry + run aggregator concurrently). The
 * mesh function is deliberately NOT tagged for discovery, so it never interrogates itself. A managed Node
 * runtime needs no bootstrap; Terraform points the function's `handler` at `mesh.handler`.
 */
import { LambdaClient } from '@aws-sdk/client-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { MeshAggregator } from '@benzenejs/mesh-aggregator';
import { MeshDiscoveryFilter, MeshDiscoveryRunner, MeshRegistryJson } from '@benzenejs/mesh-contracts';
import { AwsLambdaDiscoveryProvider } from '@benzenejs/mesh-discovery-aws';
import { LambdaMeshServiceSource } from '@benzenejs/mesh-aws-lambda';
import { AwsLambdaClient } from '@benzenejs/clients-aws-lambda';
import { S3MeshArtifactStore } from '@benzenejs/mesh-aws-s3';

/** The aggregation summary returned to the caller (mirrors .NET's `MeshAggregateSummary`). */
interface MeshAggregateSummary {
  discovered: number;
}

const bucket = requiredEnv('MESH_ARTIFACT_BUCKET');
const prefix = process.env['MESH_ARTIFACT_PREFIX'] ?? '';

// Built once per cold start, region + credentials from the Lambda execution role. The Lambda client is
// used both for discovery (ListFunctions/ListTags) and interrogation (synchronous Invoke).
const lambda = new LambdaClient({});
const discovery = new MeshDiscoveryRunner([new AwsLambdaDiscoveryProvider(lambda)]);
const store = new S3MeshArtifactStore(new S3Client({}), bucket, prefix);
const aggregator = new MeshAggregator([new LambdaMeshServiceSource(() => new AwsLambdaClient(lambda))], store);

/**
 * The mesh handler. Transport-agnostic on purpose: the EventBridge schedule fires it with a constant
 * payload and an on-demand invoke can pass anything — either way it runs the discover → aggregate pass and
 * returns how many services it catalogued. The event is intentionally unused.
 */
export async function handler(): Promise<MeshAggregateSummary> {
  // 1. Discover benzene-tagged services (default filter).
  const registry = await discovery.discoverAsync(new MeshDiscoveryFilter());

  // 2. Persist the discovered config AND interrogate + publish the catalog concurrently — the registry.json
  //    write is independent of the aggregation run (which takes the registry object directly, not from S3).
  await Promise.all([
    store.publishAsync('registry.json', MeshRegistryJson.serialize(registry)),
    aggregator.runOnceAsync(registry),
  ]);

  return { discovered: registry.services.length };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is required.`);
  }
  return value;
}
