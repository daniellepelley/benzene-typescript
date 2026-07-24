/** Port of Benzene.Mesh.Aggregator.HttpMeshServiceSource. */
import { MeshServiceRegistryEntry, MeshServiceSource } from '@benzene/mesh-contracts';
import { IMeshServiceSource } from './IMeshServiceSource';

/** A `fetch`-like function - the port of C# `HttpClient` (`HttpClient` -> injectable `fetch`). */
export type ServiceFetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * The port of .NET's `HttpRequestException` - thrown by {@link HttpMeshServiceSource.fetchSpecAsync} on a
 * non-2xx response (`GetStringAsync`'s `EnsureSuccessStatusCode`). `MeshAggregator` records only its
 * `name` ("HttpRequestException"), never the message/body, so a failed fetch can't leak a service's payload.
 */
export class HttpRequestException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HttpRequestException';
  }
}

/**
 * The default `IMeshServiceSource` - fetches `MeshServiceRegistryEntry.specUrl`/`healthUrl` over HTTP.
 * This is `MeshAggregator`'s original (pre-`IMeshServiceSource`) behavior.
 *
 * `HttpClient` -> an injectable `fetch` (default global `fetch`, the `@benzene/health-checks-http` pattern).
 * `GetStringAsync` throws on a non-2xx response, so the spec fetch throws when `!response.ok`; the health
 * fetch deliberately reads the body regardless of status (see {@link fetchHealthAsync}).
 */
export class HttpMeshServiceSource implements IMeshServiceSource {
  constructor(private readonly fetchFn: ServiceFetch = fetch) {}

  get key(): string {
    return MeshServiceSource.http;
  }

  async fetchSpecAsync(entry: MeshServiceRegistryEntry, cancellationToken?: AbortSignal): Promise<string> {
    return this.getStringAsync(entry.specUrl, cancellationToken);
  }

  async tryFetchSpecAsync(
    entry: MeshServiceRegistryEntry,
    specType: string,
    cancellationToken?: AbortSignal,
  ): Promise<string | undefined> {
    const url = HttpMeshServiceSource.specUrlForType(entry.specUrl, specType);
    return url === undefined ? undefined : this.getStringAsync(url, cancellationToken);
  }

  async fetchHealthAsync(entry: MeshServiceRegistryEntry, cancellationToken?: AbortSignal): Promise<string> {
    // Deliberately not throwing on a non-2xx status: Benzene's own health-check middleware maps an
    // unhealthy aggregate result to HTTP 503, which a throw-on-error fetch would treat as a fetch
    // failure indistinguishable from the service being genuinely unreachable. Reading the body
    // regardless of status code lets a real 503-with-a-valid-unhealthy-body come through as Unhealthy
    // instead of Unreachable - only a connection-level failure (fetch rejects) counts as unreachable.
    const response = await this.fetchFn(entry.healthUrl, { signal: cancellationToken });
    return response.text();
  }

  /** Mirrors `HttpClient.GetStringAsync`: throws on a non-2xx response, otherwise returns the body text. */
  private async getStringAsync(url: string, cancellationToken?: AbortSignal): Promise<string> {
    const response = await this.fetchFn(url, { signal: cancellationToken });
    if (!response.ok) {
      throw new HttpRequestException(`GET ${url} failed with status ${response.status}.`);
    }
    return response.text();
  }

  /**
   * Derives an alternate-spec-type URL from the benzene `specUrl` by setting `type=<specType>&format=json`
   * and preserving the rest of the URL - the benzene and asyncapi specs are the same `spec` endpoint
   * differing only by `type`. Returns `undefined` for a blank spec URL.
   */
  static specUrlForType(specUrl: string, specType: string): string | undefined {
    if (specUrl.trim().length === 0) {
      return undefined;
    }

    const fragmentIndex = specUrl.indexOf('#');
    const fragment = fragmentIndex >= 0 ? specUrl.substring(fragmentIndex) : '';
    const withoutFragment = fragmentIndex >= 0 ? specUrl.substring(0, fragmentIndex) : specUrl;

    const queryIndex = withoutFragment.indexOf('?');
    const basePart = queryIndex >= 0 ? withoutFragment.substring(0, queryIndex) : withoutFragment;
    const query = queryIndex >= 0 ? withoutFragment.substring(queryIndex + 1) : '';

    // Keep any pre-existing query params except type/format, which we set ourselves.
    const pairs = query
      .split('&')
      .filter(
        (pair) =>
          pair.length > 0 &&
          !pair.toLowerCase().startsWith('type=') &&
          !pair.toLowerCase().startsWith('format='),
      );
    pairs.unshift('format=json');
    pairs.unshift('type=' + encodeURIComponent(specType));

    return basePart + '?' + pairs.join('&') + fragment;
  }
}
