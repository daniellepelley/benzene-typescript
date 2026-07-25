/** Port of Benzene.Mesh.Discovery.Azure.AzureAppServiceDiscoveryProvider. */
import { IMeshDiscoveryProvider, MeshDiscoveryFilter, MeshServiceRegistryEntry } from '@benzene/mesh-contracts';
import { IAzureResourceLister } from './IAzureResourceLister';

const DefaultSpecPath = '/benzene/spec?type=benzene';
const DefaultHealthPath = '/benzene/health';

/**
 * Discovers Benzene services by enumerating the Azure App Service / Function App resources
 * (`Microsoft.Web/sites`) in a subscription, keeping those that match the `MeshDiscoveryFilter` (by default,
 * carry the `benzene` tag), and emitting an HTTP registry entry per site at its default hostname
 * (`https://{host}/benzene/spec|health`). App Services are HTTP-addressable, so entries use the default HTTP
 * interrogation source (`MeshServiceSource.http`) - the aggregator's `HttpMeshServiceSource` interrogates each.
 *
 * A site's host defaults to `{name}.azurewebsites.net`; override it (custom domain) with the `benzene:host`
 * tag, and the spec/health paths with `benzene:spec-path`/`benzene:health-path`.
 */
export class AzureAppServiceDiscoveryProvider implements IMeshDiscoveryProvider {
  /** Tag overriding the host (default `{name}.azurewebsites.net`). */
  static readonly HostTag = 'benzene:host';

  /** Tag overriding the spec path (default `/benzene/spec?type=benzene`). */
  static readonly SpecPathTag = 'benzene:spec-path';

  /** Tag overriding the health path (default `/benzene/health`). */
  static readonly HealthPathTag = 'benzene:health-path';

  constructor(private readonly lister: IAzureResourceLister) {}

  get key(): string {
    return 'Azure';
  }

  async discoverAsync(
    filter: MeshDiscoveryFilter,
    cancellationToken?: AbortSignal,
  ): Promise<readonly MeshServiceRegistryEntry[]> {
    const resources = await this.lister.listWebAppsAsync(cancellationToken);

    const entries: MeshServiceRegistryEntry[] = [];
    for (const resource of resources) {
      if (!filter.matches(resource.tags)) {
        continue;
      }

      if (
        filter.regions !== undefined &&
        resource.location !== undefined &&
        !filter.regions.some((region) => region.toLowerCase() === resource.location!.toLowerCase())
      ) {
        continue;
      }

      const defaultHost = resource.defaultHost ?? `${resource.name}.azurewebsites.net`;
      const host = sanitizeHost(tagOrDefault(resource.tags, AzureAppServiceDiscoveryProvider.HostTag, defaultHost), defaultHost);
      const specPath = sanitizePath(tagOrDefault(resource.tags, AzureAppServiceDiscoveryProvider.SpecPathTag, DefaultSpecPath), DefaultSpecPath);
      const healthPath = sanitizePath(
        tagOrDefault(resource.tags, AzureAppServiceDiscoveryProvider.HealthPathTag, DefaultHealthPath),
        DefaultHealthPath,
      );

      entries.push(new MeshServiceRegistryEntry(resource.name, `https://${host}${specPath}`, `https://${host}${healthPath}`));
    }

    return entries;
  }
}

function tagOrDefault(tags: Record<string, string>, key: string, fallback: string): string {
  const value = tags[key];
  return value !== undefined && value.trim().length > 0 ? value : fallback;
}

// A host tag carries an attacker-influenceable value (anyone who can tag the resource). Reject anything that
// isn't a bare host[:port] authority: a value carrying a path, scheme, userinfo, or whitespace/CRLF could
// otherwise restructure the "https://{host}{path}" URL and point the aggregator's fetch at a different host
// (SSRF). An invalid override falls back to the safe default host rather than aborting the whole sweep.
function sanitizeHost(host: string, fallback: string): string {
  return isBareAuthority(host) ? host : fallback;
}

function isBareAuthority(value: string): boolean {
  if (value.trim().length === 0) {
    return false;
  }

  for (const c of value) {
    if (c === '/' || c === '\\' || c === '@' || c === '?' || c === '#' || /\s/.test(c)) {
      return false;
    }
  }

  return true;
}

// A path override must be a real path (start with '/'); otherwise "{host}{path}" would graft the value onto
// the host - e.g. ".evil.com/spec" makes "myapp.azurewebsites.net.evil.com/spec" - and redirect the fetch
// off-host. An invalid override falls back to the safe default path.
function sanitizePath(path: string, fallback: string): string {
  return path.startsWith('/') ? path : fallback;
}
