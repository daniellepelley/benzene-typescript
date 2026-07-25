/** Port of Benzene.Mesh.Discovery.Azure.IAzureResourceLister (+ AzureResourceInfo). */
import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * The subset of an Azure App Service / Function App resource that mesh discovery needs. C# `record` ->
 * a plain interface; `IReadOnlyDictionary` -> `Record`; nullable strings -> `| undefined`.
 */
export interface AzureResourceInfo {
  /** The resource name (used as the mesh service name and, by convention, its default host). */
  readonly name: string;
  /** The Azure region the resource is in (for region scoping), or `undefined` if unknown. */
  readonly location: string | undefined;
  /** The resource's default hostname if known (e.g. `orders.azurewebsites.net`), else `undefined`. */
  readonly defaultHost: string | undefined;
  /** The resource's tags (matched against the discovery filter). */
  readonly tags: Record<string, string>;
}

/**
 * A minimal port over Azure Resource Manager for listing the App Service / Function App resources
 * (`Microsoft.Web/sites`) in a subscription, so `AzureAppServiceDiscoveryProvider`'s discovery logic
 * (tag/region filtering, URL building) is unit-testable without the Azure SDK. The real implementation is
 * `AzureArmResourceLister`. `CancellationToken` -> optional `AbortSignal`.
 */
export interface IAzureResourceLister {
  /** Lists the `Microsoft.Web/sites` resources in the subscription. */
  listWebAppsAsync(cancellationToken?: AbortSignal): Promise<AzureResourceInfo[]>;
}

/** Container token: the discovery provider resolves its lister by this interface. */
export const IAzureResourceLister: ServiceToken<IAzureResourceLister> =
  serviceToken<IAzureResourceLister>('IAzureResourceLister');
