/** Port of Benzene.Mesh.Discovery.Kubernetes.KubernetesApiServiceLister. */
import { CoreV1Api } from '@kubernetes/client-node';
import { IKubernetesServiceLister, KubernetesServiceInfo } from './IKubernetesServiceLister';

/**
 * The real `IKubernetesServiceLister` over the Kubernetes client SDK's `CoreV1Api`. Kept thin (no discovery
 * logic) so the SDK coupling lives in one place and `KubernetesServiceDiscoveryProvider` stays
 * unit-testable against the port.
 *
 * `KubernetesClient`/`IKubernetes` -> `@kubernetes/client-node`'s `CoreV1Api`; the v1 client's list methods
 * take a single param object (`listServiceForAllNamespaces({ labelSelector })` /
 * `listNamespacedService({ namespace, labelSelector })`). The `CancellationToken` isn't threaded - the JS
 * client's abort handling is via `ConfigurationOptions`, not a token, and this thin lister isn't unit-tested.
 */
export class KubernetesApiServiceLister implements IKubernetesServiceLister {
  constructor(private readonly client: CoreV1Api) {}

  async listServicesAsync(
    namespace: string | undefined,
    labelSelector: string,
    _cancellationToken?: AbortSignal,
  ): Promise<KubernetesServiceInfo[]> {
    const list =
      namespace === undefined
        ? await this.client.listServiceForAllNamespaces({ labelSelector })
        : await this.client.listNamespacedService({ namespace, labelSelector });

    const services: KubernetesServiceInfo[] = [];
    for (const service of list.items ?? []) {
      const name = service.metadata?.name;
      if (name === undefined || name.length === 0) {
        continue;
      }

      services.push({
        name,
        namespace: service.metadata?.namespace ?? 'default',
        port: service.spec?.ports?.[0]?.port ?? 80,
        labels: service.metadata?.labels ?? {},
      });
    }

    return services;
  }
}
