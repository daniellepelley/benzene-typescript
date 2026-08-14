/** Port of Benzene.Mesh.Discovery.Kubernetes.IKubernetesServiceLister (+ KubernetesServiceInfo). */
import { ServiceToken, serviceToken } from '@benzenejs/abstractions';

/**
 * The subset of a Kubernetes Service that mesh discovery needs. C# `record` -> a plain interface;
 * `IReadOnlyDictionary` -> `Record`.
 */
export interface KubernetesServiceInfo {
  /** The Service's metadata name (used as the mesh service name and DNS host). */
  readonly name: string;
  /** The Service's namespace (part of its in-cluster DNS). */
  readonly namespace: string;
  /** The Service's first exposed port (the port its cluster DNS resolves traffic to). */
  readonly port: number;
  /** The Service's labels (matched against the discovery filter). */
  readonly labels: Record<string, string>;
}

/**
 * A minimal port over the Kubernetes API for listing Services, so `KubernetesServiceDiscoveryProvider`'s
 * discovery logic (label-selector construction, URL building, filtering) is unit-testable without the
 * Kubernetes client SDK. The real implementation is `KubernetesApiServiceLister`. `CancellationToken` ->
 * optional `AbortSignal`; `string?` namespace -> `string | undefined` (`undefined` = all namespaces).
 */
export interface IKubernetesServiceLister {
  /** Lists Services matching `labelSelector` in `namespace` (or across all namespaces when it is `undefined`). */
  listServicesAsync(
    namespace: string | undefined,
    labelSelector: string,
    cancellationToken?: AbortSignal,
  ): Promise<KubernetesServiceInfo[]>;
}

/** Container token: the discovery provider resolves its lister by this interface. */
export const IKubernetesServiceLister: ServiceToken<IKubernetesServiceLister> =
  serviceToken<IKubernetesServiceLister>('IKubernetesServiceLister');
