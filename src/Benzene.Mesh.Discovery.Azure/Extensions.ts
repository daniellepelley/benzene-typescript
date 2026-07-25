/** Port of Benzene.Mesh.Discovery.Azure.Extensions. */
import { ResourceManagementClient } from '@azure/arm-resources';
import { DefaultAzureCredential } from '@azure/identity';
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { IMeshDiscoveryProvider, MeshDiscoveryRunner } from '@benzene/mesh-contracts';
import { AzureAppServiceDiscoveryProvider } from './AzureAppServiceDiscoveryProvider';
import { AzureArmResourceLister } from './AzureArmResourceLister';
import { IAzureResourceLister } from './IAzureResourceLister';

/**
 * Registers `AzureAppServiceDiscoveryProvider` (as an additional `IMeshDiscoveryProvider`) over a
 * `ResourceManagementClient` authenticated with `DefaultAzureCredential` (managed identity in Azure, the dev
 * credential locally), plus a `MeshDiscoveryRunner` over all registered providers. The identity needs
 * `Reader` on the resources it enumerates.
 *
 * Divergence from C#: JS's `ResourceManagementClient` is subscription-scoped at construction (there's no
 * `GetDefaultSubscriptionAsync`), so a subscription id is required - passed here or read from the
 * `AZURE_SUBSCRIPTION_ID` environment variable.
 *
 * @param subscriptionId The subscription to enumerate. Falls back to `AZURE_SUBSCRIPTION_ID`; required.
 * @param resourceGroup If set, discovery is constrained to this resource group (recommended when the
 * identity holds Reader at subscription scope).
 */
export function addMeshAzureDiscovery(
  services: IBenzeneServiceContainer,
  subscriptionId?: string,
  resourceGroup?: string,
): IBenzeneServiceContainer {
  const resolvedSubscriptionId = subscriptionId ?? process.env['AZURE_SUBSCRIPTION_ID'];
  if (resolvedSubscriptionId === undefined || resolvedSubscriptionId.trim().length === 0) {
    throw new Error(
      'addMeshAzureDiscovery requires a subscription id (pass one explicitly or set AZURE_SUBSCRIPTION_ID) - ' +
        "the JS ResourceManagementClient is subscription-scoped and has no default-subscription resolution.",
    );
  }

  services.addSingletonFactory(
    IAzureResourceLister,
    () => new AzureArmResourceLister(new ResourceManagementClient(new DefaultAzureCredential(), resolvedSubscriptionId), resourceGroup),
  );
  services.addSingletonFactory(
    IMeshDiscoveryProvider,
    (resolver) => new AzureAppServiceDiscoveryProvider(resolver.getService(IAzureResourceLister)),
  );
  services.addSingletonFactory(MeshDiscoveryRunner, (resolver) => new MeshDiscoveryRunner(resolver.getServices(IMeshDiscoveryProvider)));
  return services;
}
