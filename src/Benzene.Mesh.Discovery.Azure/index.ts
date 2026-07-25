/**
 * Port of Benzene.Mesh.Discovery.Azure - self-discovery of Benzene services from Azure App Service /
 * Function App resources (`Microsoft.Web/sites`). `AzureAppServiceDiscoveryProvider` (pure tag/region
 * filtering + SSRF-safe URL building) sits over the `IAzureResourceLister` seam, whose real implementation
 * (`AzureArmResourceLister`) adapts `Azure.ResourceManager` to `@azure/arm-resources`. Wired via
 * `addMeshAzureDiscovery`.
 */
export * from './IAzureResourceLister';
export * from './AzureAppServiceDiscoveryProvider';
export * from './AzureArmResourceLister';
export * from './Extensions';
