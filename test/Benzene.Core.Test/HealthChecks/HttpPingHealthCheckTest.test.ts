import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { BenzeneResultStatus } from '@benzene/results';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { HealthCheckResponse, HealthCheckStatus } from '@benzene/health-checks-core';
import { getHealthCheckerBuilder, HealthCheckProcessor } from '@benzene/health-checks';
import { HttpPingHealthCheck, PingFetch, addHttpPing } from '@benzene/health-checks-http';

/**
 * Ports the http-ping health-check test: a `HttpPingHealthCheck` over a STUBBED fetch (per the
 * HttpClient -> fetch adaptation) reports healthy on 200 and unhealthy on 503, and pings the
 * configured URL. No real network call happens.
 */

/** A fake `fetch` that records the URL it was called with and returns a canned `Response`. */
function stubFetch(status: number): { fetchFn: PingFetch; calledUrl: () => string | undefined } {
  let captured: string | undefined;
  const fetchFn: PingFetch = (url) => {
    captured = url;
    return Promise.resolve(new Response(null, { status }));
  };
  return { fetchFn, calledUrl: () => captured };
}

describe('HttpPingHealthCheck', () => {
  it('Execute_On200_IsHealthyAndPingsUrl', async () => {
    const { fetchFn, calledUrl } = stubFetch(200);
    const check = new HttpPingHealthCheck('http://svc/health', fetchFn);

    const result = await check.executeAsync();

    expect(calledUrl()).toBe('http://svc/health');
    expect(check.type).toBe('HttpPing');
    expect(result.status).toBe(HealthCheckStatus.ok);
    expect(result.data.Url).toBe('http://svc/health');
    expect(result.data.StatusCode).toBe(200);
    expect(result.dependencies).toEqual([{ kind: 'Http', name: 'http://svc/health' }]);
  });

  it('Execute_On503_IsUnhealthy', async () => {
    const { fetchFn, calledUrl } = stubFetch(503);
    const check = new HttpPingHealthCheck('http://svc/health', fetchFn);

    const result = await check.executeAsync();

    expect(calledUrl()).toBe('http://svc/health');
    expect(result.status).toBe(HealthCheckStatus.failed);
    expect(result.data.StatusCode).toBe(503);
  });

  it('AddHttpPing_RegistersCheck_RunsThroughAggregator', async () => {
    const container = new DefaultBenzeneServiceContainer();
    const builder = getHealthCheckerBuilder({ register: (action) => action(container) });
    const { fetchFn } = stubFetch(200);
    addHttpPing(builder, 'http://svc/health', fetchFn);

    const scope = container.createServiceResolverFactory().createScope();
    const result = (await HealthCheckProcessor.performHealthChecksAsync(
      'healthcheck',
      builder.getHealthChecks(scope),
    )) as IBenzeneResultOf<HealthCheckResponse>;
    scope.dispose();

    expect(result.status).toBe(BenzeneResultStatus.ok);
    expect(result.payload.isHealthy).toBe(true);
    expect(result.payload.healthChecks.HttpPing.status).toBe(HealthCheckStatus.ok);
  });
});
