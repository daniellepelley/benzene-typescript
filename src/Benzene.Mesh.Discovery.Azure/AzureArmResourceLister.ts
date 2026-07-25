/** Port of Benzene.Mesh.Discovery.Azure.AzureArmResourceLister. */
import { ResourceManagementClient } from '@azure/arm-resources';
import { AzureResourceInfo, IAzureResourceLister } from './IAzureResourceLister';

/**
 * The real `IAzureResourceLister` over Azure Resource Manager. Kept thin (no discovery logic) so the SDK
 * coupling lives in one place and `AzureAppServiceDiscoveryProvider` stays unit-testable against the port.
 * Enumerates the `Microsoft.Web/sites` resources in a subscription, optionally constrained to one resource
 * group.
 *
 * `Azure.ResourceManager` -> `@azure/arm-resources` (the JS-ecosystem equivalent). Divergence: C#'s
 * `ArmClient` is tenant-scoped and picks the subscription per call (`GetDefaultSubscriptionAsync`), whereas
 * JS's `ResourceManagementClient` is *subscription-scoped at construction* - so the subscription choice
 * moves to where the client is built (`addMeshAzureDiscovery`), and this lister only holds the optional
 * resource-group filter. The resource group isn't a field on the list item, so it's parsed from the ARM id.
 * Deployment slots (`Microsoft.Web/sites/slots`) are a distinct resource type and never returned; Function
 * Apps are `Microsoft.Web/sites` and are returned when tagged (the tag filter is the gate).
 */
export class AzureArmResourceLister implements IAzureResourceLister {
  private readonly resourceGroup: string | undefined;

  /**
   * @param client The subscription-scoped ARM client.
   * @param resourceGroup If set, only sites in this resource group are returned (matched case-insensitively).
   */
  constructor(
    private readonly client: ResourceManagementClient,
    resourceGroup?: string,
  ) {
    this.resourceGroup = resourceGroup !== undefined && resourceGroup.trim().length > 0 ? resourceGroup : undefined;
  }

  async listWebAppsAsync(_cancellationToken?: AbortSignal): Promise<AzureResourceInfo[]> {
    const resources: AzureResourceInfo[] = [];
    for await (const resource of this.client.resources.list({ filter: "resourceType eq 'Microsoft.Web/sites'" })) {
      // Scope to one resource group in code (the generic-resources $filter doesn't take a resource group),
      // so a subscription-scoped Reader identity still only discovers the intended group.
      if (this.resourceGroup !== undefined && !equalsIgnoreCase(resourceGroupOf(resource.id), this.resourceGroup)) {
        continue;
      }

      resources.push({
        name: resource.name ?? '',
        location: resource.location,
        defaultHost: undefined,
        tags: resource.tags ?? {},
      });
    }

    return resources;
  }
}

/** Extracts the resource-group segment from an ARM resource id (`/subscriptions/.../resourceGroups/{rg}/...`). */
function resourceGroupOf(id: string | undefined): string | undefined {
  if (id === undefined) {
    return undefined;
  }
  const match = /\/resourceGroups\/([^/]+)/i.exec(id);
  return match ? match[1] : undefined;
}

function equalsIgnoreCase(a: string | undefined, b: string): boolean {
  return a !== undefined && a.toLowerCase() === b.toLowerCase();
}
