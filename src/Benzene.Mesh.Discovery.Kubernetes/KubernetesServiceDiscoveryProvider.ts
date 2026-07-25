/** Port of Benzene.Mesh.Discovery.Kubernetes.KubernetesServiceDiscoveryProvider. */
import { IMeshDiscoveryProvider, MeshDiscoveryFilter, MeshServiceRegistryEntry } from '@benzene/mesh-contracts';
import { IKubernetesServiceLister } from './IKubernetesServiceLister';

const DefaultSpecPath = '/benzene/spec?type=benzene';
const DefaultHealthPath = '/benzene/health';

/**
 * Discovers Benzene services by listing the Kubernetes Services that match the `MeshDiscoveryFilter` (by
 * default, carry the `benzene` label) via the Kubernetes API, and emitting an HTTP registry entry per
 * Service pointing at its in-cluster DNS (`http://{name}.{namespace}.svc.cluster.local[:port]/benzene/spec|health`).
 * The services are HTTP-addressable in-cluster, so entries use the default HTTP interrogation source
 * (`MeshServiceSource.http`) - `HttpMeshServiceSource` interrogates each.
 *
 * The mesh's ServiceAccount needs RBAC to `list` Services. Spec/health paths follow the Cloud Service
 * Profile defaults; a Service can override them with `benzene.spec-path`/`benzene.health-path` labels, and
 * its scheme/port with `benzene.scheme`.
 */
export class KubernetesServiceDiscoveryProvider implements IMeshDiscoveryProvider {
  /** Label overriding the spec path (default `/benzene/spec?type=benzene`). */
  static readonly SpecPathLabel = 'benzene.spec-path';

  /** Label overriding the health path (default `/benzene/health`). */
  static readonly HealthPathLabel = 'benzene.health-path';

  /** Label overriding the URL scheme (default `http`). */
  static readonly SchemeLabel = 'benzene.scheme';

  constructor(private readonly lister: IKubernetesServiceLister) {}

  get key(): string {
    return 'Kubernetes';
  }

  async discoverAsync(
    filter: MeshDiscoveryFilter,
    cancellationToken?: AbortSignal,
  ): Promise<readonly MeshServiceRegistryEntry[]> {
    const services = await this.lister.listServicesAsync(
      filter.namespace,
      KubernetesServiceDiscoveryProvider.buildLabelSelector(filter),
      cancellationToken,
    );

    const entries: MeshServiceRegistryEntry[] = [];
    for (const service of services) {
      // The lister already applied the label selector server-side, but re-check locally so the provider
      // honours the filter's exact-value semantics uniformly across platforms.
      if (!filter.matches(service.labels)) {
        continue;
      }

      const scheme = sanitizeScheme(labelOrDefault(service.labels, KubernetesServiceDiscoveryProvider.SchemeLabel, 'http'));
      const authority = `${service.name}.${service.namespace}.svc.cluster.local${portSuffix(scheme, service.port)}`;
      const specPath = sanitizePath(
        labelOrDefault(service.labels, KubernetesServiceDiscoveryProvider.SpecPathLabel, DefaultSpecPath),
        DefaultSpecPath,
      );
      const healthPath = sanitizePath(
        labelOrDefault(service.labels, KubernetesServiceDiscoveryProvider.HealthPathLabel, DefaultHealthPath),
        DefaultHealthPath,
      );

      entries.push(new MeshServiceRegistryEntry(service.name, `${scheme}://${authority}${specPath}`, `${scheme}://${authority}${healthPath}`));
    }

    return entries;
  }

  /**
   * Builds a Kubernetes label selector from the filter's tags: `key` (present with any value) or
   * `key=value` (exact match), comma-joined - the same semantics Kubernetes applies natively.
   */
  static buildLabelSelector(filter: MeshDiscoveryFilter): string {
    return Object.entries(filter.tags)
      .map(([key, value]) => (value === null ? key : `${key}=${value}`))
      .join(',');
  }
}

function portSuffix(scheme: string, port: number): string {
  const defaultPort = scheme.toLowerCase() === 'https' ? 443 : 80;
  return port === defaultPort || port <= 0 ? '' : `:${port}`;
}

// The scheme label carries an attacker-influenceable value (anyone who can label the Service). Only
// http/https may be used: a value like "https://evil.com/" would otherwise restructure the
// "{scheme}://{authority}{path}" URL and redirect the aggregator's fetch off-cluster (SSRF). An
// unrecognised scheme falls back to the safe http default rather than aborting discovery.
function sanitizeScheme(scheme: string): string {
  const lower = scheme.toLowerCase();
  return lower === 'http' || lower === 'https' ? scheme : 'http';
}

// A path override must be a real path (start with '/'); otherwise "{authority}{path}" would graft the value
// onto the authority and redirect the fetch off the in-cluster host. An invalid override falls back to the
// safe default path.
function sanitizePath(path: string, fallback: string): string {
  return path.startsWith('/') ? path : fallback;
}

function labelOrDefault(labels: Record<string, string>, key: string, fallback: string): string {
  const value = labels[key];
  return value !== undefined && value.trim().length > 0 ? value : fallback;
}
