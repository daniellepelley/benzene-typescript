import { describe, expect, it } from 'vitest';
import {
  AzureAppServiceDiscoveryProvider,
  AzureResourceInfo,
  IAzureResourceLister,
} from '@benzenejs/mesh-discovery-azure';
import { MeshDiscoveryFilter, MeshServiceSource } from '@benzenejs/mesh-contracts';

/**
 * Port of test/Benzene.Mesh.Test/Discovery/AzureAppServiceDiscoveryProviderTest.cs. The Moq
 * `IAzureResourceLister` becomes a hand-written stub; the pure discovery logic (tag/region filter,
 * SSRF-safe host/path sanitisation) is exercised without the Azure SDK.
 */
function site(name: string, location = 'westeurope', ...tags: [string, string][]): AzureResourceInfo {
  return { name, location, defaultHost: undefined, tags: Object.fromEntries(tags) };
}

function listerWith(...sites: AzureResourceInfo[]): IAzureResourceLister {
  return { listWebAppsAsync: () => Promise.resolve(sites) };
}

describe('AzureAppServiceDiscoveryProvider', () => {
  it('Discover_EmitsHttpEntriesAtDefaultAzureHost', async () => {
    const lister = listerWith(site('orders', 'westeurope', ['benzene', 'true']), site('unrelated', 'westeurope', ['team', 'x']));

    const provider = new AzureAppServiceDiscoveryProvider(lister);
    const entries = await provider.discoverAsync(new MeshDiscoveryFilter());

    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.name).toBe('orders');
    expect(entry.source).toBe(MeshServiceSource.http);
    expect(entry.specUrl).toBe('https://orders.azurewebsites.net/benzene/spec?type=benzene');
    expect(entry.healthUrl).toBe('https://orders.azurewebsites.net/benzene/health');
  });

  it('Discover_RespectsHostAndPathTagOverrides', async () => {
    const lister = listerWith(
      site(
        'orders',
        'westeurope',
        ['benzene', 'true'],
        [AzureAppServiceDiscoveryProvider.HostTag, 'orders.contoso.com'],
        [AzureAppServiceDiscoveryProvider.SpecPathTag, '/x/spec'],
      ),
    );

    const provider = new AzureAppServiceDiscoveryProvider(lister);
    const entries = await provider.discoverAsync(new MeshDiscoveryFilter());

    expect(entries).toHaveLength(1);
    expect(entries[0]!.specUrl).toBe('https://orders.contoso.com/x/spec');
    expect(entries[0]!.healthUrl).toBe('https://orders.contoso.com/benzene/health');
  });

  it('Discover_HostTagRestructuringTheUrl_FallsBackToDefaultHost', async () => {
    // A host tag carrying a path/scheme/userinfo could restructure "https://{host}{path}" and redirect the
    // aggregator's fetch off-host (SSRF). Such a value is rejected for the safe default host.
    const lister = listerWith(
      site('orders', 'westeurope', ['benzene', 'true'], [AzureAppServiceDiscoveryProvider.HostTag, 'evil.com/@orders.azurewebsites.net']),
    );

    const provider = new AzureAppServiceDiscoveryProvider(lister);
    const entries = await provider.discoverAsync(new MeshDiscoveryFilter());

    expect(entries[0]!.specUrl).toBe('https://orders.azurewebsites.net/benzene/spec?type=benzene');
  });

  it('Discover_SpecPathTagNotStartingWithSlash_FallsBackToDefault', async () => {
    // A path override that doesn't start with '/' would graft onto the host and redirect off-host.
    const lister = listerWith(
      site('orders', 'westeurope', ['benzene', 'true'], [AzureAppServiceDiscoveryProvider.SpecPathTag, '.evil.com/spec']),
    );

    const provider = new AzureAppServiceDiscoveryProvider(lister);
    const entries = await provider.discoverAsync(new MeshDiscoveryFilter());

    expect(entries[0]!.specUrl).toBe('https://orders.azurewebsites.net/benzene/spec?type=benzene');
  });

  it('Discover_RegionFilter_ExcludesOtherRegions', async () => {
    const lister = listerWith(site('eu-svc', 'westeurope', ['benzene', 'true']), site('us-svc', 'eastus', ['benzene', 'true']));

    const provider = new AzureAppServiceDiscoveryProvider(lister);
    const entries = await provider.discoverAsync(new MeshDiscoveryFilter(undefined, ['westeurope']));

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('eu-svc');
  });

  it('Discover_ValuedTagFilter_ExcludesNonMatching', async () => {
    const lister = listerWith(site('prod-svc', 'westeurope', ['benzene', 'prod']), site('dev-svc', 'westeurope', ['benzene', 'dev']));

    const provider = new AzureAppServiceDiscoveryProvider(lister);
    const entries = await provider.discoverAsync(new MeshDiscoveryFilter({ benzene: 'prod' }));

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('prod-svc');
  });
});
