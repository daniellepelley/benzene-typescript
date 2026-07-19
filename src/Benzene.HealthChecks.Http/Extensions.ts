/** Port of Benzene.HealthChecks.Http.Extensions. */
import { addHealthCheckFactory, IHealthCheckBuilder } from '@benzene/health-checks-core';
import { PingFetch } from './HttpPingHealthCheck';
import { HttpPingHealthCheckFactory } from './HttpPingHealthCheckFactory';

/**
 * Registration helper for `HttpPingHealthCheck`. C# extension method becomes a free function.
 * Registers a check that GETs `url` and requires a 200 OK response to be considered healthy.
 *
 * The optional `fetchFn` is the port's HttpClient -> fetch injection point (defaulting to the Node
 * global `fetch`); pass a stub to test without a real network call.
 */
export function addHttpPing(
  builder: IHealthCheckBuilder,
  url: string,
  fetchFn?: PingFetch,
): IHealthCheckBuilder {
  return addHealthCheckFactory(builder, new HttpPingHealthCheckFactory(url, fetchFn));
}
