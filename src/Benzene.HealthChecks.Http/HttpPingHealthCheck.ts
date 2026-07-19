/** Port of Benzene.HealthChecks.Http.HttpPingHealthCheck. */
import {
  HealthCheckDependency,
  HealthCheckResult,
  IHealthCheck,
  IHealthCheckResult,
} from '@benzene/health-checks-core';

/**
 * A `fetch`-like function: GETs a URL and returns the response.
 * Port of the role played by .NET `HttpClient.GetAsync`.
 */
export type PingFetch = (url: string) => Promise<Response>;

/** The default adapter over the Node global `fetch`, issuing a GET to the given URL. */
export const defaultPingFetch: PingFetch = (url) => fetch(url);

/**
 * Checks a downstream HTTP dependency by issuing a GET request and treating a `200 OK` response as
 * healthy - any other status code (including non-2xx success codes) is reported unhealthy.
 *
 * HttpClient -> fetch adaptation: .NET injects an `HttpClient` and calls `GetAsync`. The port injects
 * a `fetch`-like function instead - defaulting to the Node global `fetch` (via {@link defaultPingFetch})
 * but accepting an injected one so tests can stub the transport, exactly as `@benzene/client-http`'s
 * `HttpClientMiddleware` does. The transport moves to a trailing optional constructor argument (C#
 * had `(httpClient, url)`) so it can default to the global `fetch`.
 */
export class HttpPingHealthCheck implements IHealthCheck {
  constructor(
    private readonly url: string,
    private readonly fetchFn: PingFetch = defaultPingFetch,
  ) {}

  get type(): string {
    return 'HttpPing';
  }

  /**
   * Issues a GET to the configured URL and reports healthy only for a 200 OK response. The result's
   * `data` always includes the checked `Url` and the response's numeric `StatusCode`, and its
   * `dependencies` include one `HealthCheckDependency("Http", url)`.
   */
  async executeAsync(): Promise<IHealthCheckResult> {
    const dependencies = [new HealthCheckDependency('Http', this.url)];

    const response = await this.fetchFn(this.url);
    return HealthCheckResult.createInstance(
      response.status === 200,
      this.type,
      { Url: this.url, StatusCode: response.status },
      dependencies,
    );
  }
}
