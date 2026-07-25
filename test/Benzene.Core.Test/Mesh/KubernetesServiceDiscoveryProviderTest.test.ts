import { describe, expect, it } from 'vitest';
import { MeshDiscoveryFilter, MeshServiceSource } from '@benzene/mesh-contracts';
import {
  IKubernetesServiceLister,
  KubernetesServiceDiscoveryProvider,
  KubernetesServiceInfo,
} from '@benzene/mesh-discovery-kubernetes';

/**
 * Port of test/Benzene.Mesh.Test/Discovery/KubernetesServiceDiscoveryProviderTest.cs. The Moq
 * `IKubernetesServiceLister` becomes a hand-written stub; the pure discovery logic (label-selector build,
 * in-cluster-DNS URL building, SSRF-safe scheme/path sanitisation) is exercised without the Kubernetes SDK.
 */
function svc(name: string, port = 80, ...labels: [string, string][]): KubernetesServiceInfo {
  return { name, namespace: 'default', port, labels: Object.fromEntries(labels) };
}

function listerWith(...services: KubernetesServiceInfo[]): IKubernetesServiceLister {
  return { listServicesAsync: () => Promise.resolve(services) };
}

describe('KubernetesServiceDiscoveryProvider', () => {
  it('Discover_EmitsHttpEntriesAtInClusterDns', async () => {
    const lister = listerWith(svc('orders', 80, ['benzene', 'true']));

    const provider = new KubernetesServiceDiscoveryProvider(lister);
    const entries = await provider.discoverAsync(new MeshDiscoveryFilter());

    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.name).toBe('orders');
    expect(entry.source).toBe(MeshServiceSource.http);
    expect(entry.specUrl).toBe('http://orders.default.svc.cluster.local/benzene/spec?type=benzene');
    expect(entry.healthUrl).toBe('http://orders.default.svc.cluster.local/benzene/health');
  });

  it('Discover_NonDefaultPort_IsIncludedInAuthority', async () => {
    const lister = listerWith(svc('payments', 8080, ['benzene', 'true']));

    const provider = new KubernetesServiceDiscoveryProvider(lister);
    const entries = await provider.discoverAsync(new MeshDiscoveryFilter());

    expect(entries[0]!.specUrl).toBe('http://payments.default.svc.cluster.local:8080/benzene/spec?type=benzene');
  });

  it('Discover_RespectsPathAndSchemeLabelOverrides', async () => {
    const lister = listerWith(
      svc(
        'shipping',
        443,
        ['benzene', 'true'],
        [KubernetesServiceDiscoveryProvider.SchemeLabel, 'https'],
        [KubernetesServiceDiscoveryProvider.SpecPathLabel, '/x/spec'],
        [KubernetesServiceDiscoveryProvider.HealthPathLabel, '/x/health'],
      ),
    );

    const provider = new KubernetesServiceDiscoveryProvider(lister);
    const entries = await provider.discoverAsync(new MeshDiscoveryFilter());

    expect(entries[0]!.specUrl).toBe('https://shipping.default.svc.cluster.local/x/spec');
    expect(entries[0]!.healthUrl).toBe('https://shipping.default.svc.cluster.local/x/health');
  });

  it('Discover_ValuedTagFilter_ExcludesNonMatching', async () => {
    const lister = listerWith(svc('prod-svc', 80, ['benzene', 'prod']), svc('dev-svc', 80, ['benzene', 'dev']));

    const provider = new KubernetesServiceDiscoveryProvider(lister);
    const entries = await provider.discoverAsync(new MeshDiscoveryFilter({ benzene: 'prod' }));

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('prod-svc');
  });

  it('Discover_SchemeLabelInjectingAnotherHost_FallsBackToHttp', async () => {
    // A scheme label like "https://evil.com/" would restructure the URL and redirect the aggregator's fetch
    // off-cluster (SSRF). Only http/https are honoured; anything else falls back to the safe http default.
    const lister = listerWith(svc('orders', 80, ['benzene', 'true'], [KubernetesServiceDiscoveryProvider.SchemeLabel, 'https://evil.com/']));

    const provider = new KubernetesServiceDiscoveryProvider(lister);
    const entries = await provider.discoverAsync(new MeshDiscoveryFilter());

    expect(entries[0]!.specUrl).toBe('http://orders.default.svc.cluster.local/benzene/spec?type=benzene');
  });

  it('Discover_PathLabelNotStartingWithSlash_FallsBackToDefault', async () => {
    // A path override that doesn't start with '/' would graft onto the authority and redirect off-host.
    const lister = listerWith(svc('orders', 80, ['benzene', 'true'], [KubernetesServiceDiscoveryProvider.SpecPathLabel, '.evil.com/spec']));

    const provider = new KubernetesServiceDiscoveryProvider(lister);
    const entries = await provider.discoverAsync(new MeshDiscoveryFilter());

    expect(entries[0]!.specUrl).toBe('http://orders.default.svc.cluster.local/benzene/spec?type=benzene');
  });

  it('BuildLabelSelector_PresentAndValued', () => {
    expect(KubernetesServiceDiscoveryProvider.buildLabelSelector(new MeshDiscoveryFilter())).toBe('benzene');
    expect(KubernetesServiceDiscoveryProvider.buildLabelSelector(new MeshDiscoveryFilter({ benzene: 'prod' }))).toBe('benzene=prod');
  });

  it('Discover_PassesNamespaceAndSelectorToLister', async () => {
    const calls: { namespace: string | undefined; labelSelector: string }[] = [];
    const lister: IKubernetesServiceLister = {
      listServicesAsync: (namespace, labelSelector) => {
        calls.push({ namespace, labelSelector });
        return Promise.resolve([svc('orders', 80, ['benzene', 'true'])]);
      },
    };

    const provider = new KubernetesServiceDiscoveryProvider(lister);
    const entries = await provider.discoverAsync(new MeshDiscoveryFilter(undefined, undefined, 'mesh-ns'));

    expect(entries).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ namespace: 'mesh-ns', labelSelector: 'benzene' });
  });
});
