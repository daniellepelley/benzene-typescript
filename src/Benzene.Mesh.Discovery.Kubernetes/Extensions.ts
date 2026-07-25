/** Port of Benzene.Mesh.Discovery.Kubernetes.Extensions. */
import { CoreV1Api, KubeConfig } from '@kubernetes/client-node';
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { IMeshDiscoveryProvider, MeshDiscoveryRunner } from '@benzene/mesh-contracts';
import { IKubernetesServiceLister } from './IKubernetesServiceLister';
import { KubernetesApiServiceLister } from './KubernetesApiServiceLister';
import { KubernetesServiceDiscoveryProvider } from './KubernetesServiceDiscoveryProvider';

/**
 * Registers `KubernetesServiceDiscoveryProvider` (as an additional `IMeshDiscoveryProvider`) over an
 * in-cluster `CoreV1Api` client, plus a `MeshDiscoveryRunner` over all registered providers. Intended for a
 * mesh running inside the cluster (uses `KubeConfig.loadFromCluster()` - the port of
 * `KubernetesClientConfiguration.InClusterConfig`); its ServiceAccount needs RBAC to list Services.
 */
export function addMeshKubernetesDiscovery(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  const kubeConfig = new KubeConfig();
  kubeConfig.loadFromCluster();
  const client = kubeConfig.makeApiClient(CoreV1Api);

  services.addSingletonFactory(IKubernetesServiceLister, () => new KubernetesApiServiceLister(client));
  services.addSingletonFactory(
    IMeshDiscoveryProvider,
    (resolver) => new KubernetesServiceDiscoveryProvider(resolver.getService(IKubernetesServiceLister)),
  );
  services.addSingletonFactory(MeshDiscoveryRunner, (resolver) => new MeshDiscoveryRunner(resolver.getServices(IMeshDiscoveryProvider)));
  return services;
}
