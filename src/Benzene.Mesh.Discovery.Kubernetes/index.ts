/**
 * Port of Benzene.Mesh.Discovery.Kubernetes - self-discovery of Benzene services from Kubernetes Services.
 * `KubernetesServiceDiscoveryProvider` (pure label-selector construction, in-cluster-DNS URL building,
 * SSRF-safe scheme/path sanitisation) sits over the `IKubernetesServiceLister` seam, whose real
 * implementation (`KubernetesApiServiceLister`) adapts the Kubernetes client SDK to `@kubernetes/client-node`.
 * Wired via `addMeshKubernetesDiscovery`.
 */
export * from './IKubernetesServiceLister';
export * from './KubernetesServiceDiscoveryProvider';
export * from './KubernetesApiServiceLister';
export * from './Extensions';
