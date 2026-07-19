/** Port of Benzene.HealthChecks.Http.HttpPingHealthCheckFactory. */
import { IServiceResolver } from '@benzene/abstractions';
import { IHealthCheck, IHealthCheckFactory } from '@benzene/health-checks-core';
import { defaultPingFetch, HttpPingHealthCheck, PingFetch } from './HttpPingHealthCheck';

/**
 * Builds an `HttpPingHealthCheck` for a fixed URL.
 *
 * HttpClient -> fetch adaptation: the C# factory resolves an `HttpClient` from DI on each `Create`.
 * There is no equivalent container-registered `HttpClient` token in the port, so the factory instead
 * captures the injectable `fetch`-like transport (defaulting to the Node global `fetch`); `create`
 * ignores the resolver and constructs the check with the captured URL and transport.
 */
export class HttpPingHealthCheckFactory implements IHealthCheckFactory {
  constructor(
    private readonly url: string,
    private readonly fetchFn: PingFetch = defaultPingFetch,
  ) {}

  create(_resolver: IServiceResolver): IHealthCheck {
    return new HttpPingHealthCheck(this.url, this.fetchFn);
  }
}
