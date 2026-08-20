/** Port of Benzene.Mesh.Aws.Lambda.Extensions. */
import { LambdaClient } from '@aws-sdk/client-lambda';
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { AwsLambdaClient, IAwsLambdaClient } from '@benzenejs/clients-aws-lambda';
import { IMeshServiceSource } from '@benzenejs/mesh-aggregator';
import { IMeshServiceDispatcher } from '@benzenejs/mesh-dispatch';
import { AwsLambdaMeshServiceDispatcher } from './AwsLambdaMeshServiceDispatcher';
import { LambdaMeshServiceSource } from './LambdaMeshServiceSource';

/** A memoised lazy `IAwsLambdaClient` - built once, only the first time a Lambda-sourced service is fetched. */
function lazyLambdaClient(): () => IAwsLambdaClient {
  let client: IAwsLambdaClient | undefined;
  return () => (client ??= new AwsLambdaClient(new LambdaClient({})));
}

/**
 * Registers `LambdaMeshServiceSource` (as an additional `IMeshServiceSource`) against a default-credential
 * `LambdaClient`. Requires `addMeshAggregator(...)` in the same container - `MeshAggregator` resolves every
 * `IMeshServiceSource` (including this one). The client is built lazily so a pure-HTTP mesh never constructs
 * a Lambda client just to start.
 */
export function addMeshLambdaSource(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  const client = lazyLambdaClient();
  services.addSingletonFactory(IMeshServiceSource, () => new LambdaMeshServiceSource(client));
  return services;
}

/**
 * Registers `AwsLambdaMeshServiceDispatcher` (as an additional `IMeshServiceDispatcher`) so the opt-in
 * `benzene:mesh:dispatch` handler can invoke AWS-Lambda services (`source == AwsLambdaInvoke`). Reuses the same
 * lazily-built Lambda client / `lambda:InvokeFunction` grant as {@link addMeshLambdaSource}.
 */
export function addMeshLambdaDispatcher(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  const client = lazyLambdaClient();
  services.addSingletonFactory(IMeshServiceDispatcher, () => new AwsLambdaMeshServiceDispatcher(client));
  return services;
}
