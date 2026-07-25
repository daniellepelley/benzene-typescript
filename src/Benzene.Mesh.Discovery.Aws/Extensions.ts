/** Port of Benzene.Mesh.Discovery.Aws.Extensions. */
import { LambdaClient } from '@aws-sdk/client-lambda';
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { IMeshDiscoveryProvider, MeshDiscoveryRunner } from '@benzene/mesh-contracts';
import { AwsLambdaDiscoveryProvider } from './AwsLambdaDiscoveryProvider';

/**
 * Registers `AwsLambdaDiscoveryProvider` (as an additional `IMeshDiscoveryProvider`) against a
 * default-credential-chain `LambdaClient` (region + credentials from the ambient AWS environment), plus a
 * `MeshDiscoveryRunner` over all registered providers.
 */
export function addMeshAwsLambdaDiscovery(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  const lambda = new LambdaClient({});
  services.addSingletonFactory(IMeshDiscoveryProvider, () => new AwsLambdaDiscoveryProvider(lambda));
  services.addSingletonFactory(MeshDiscoveryRunner, (resolver) => new MeshDiscoveryRunner(resolver.getServices(IMeshDiscoveryProvider)));
  return services;
}
