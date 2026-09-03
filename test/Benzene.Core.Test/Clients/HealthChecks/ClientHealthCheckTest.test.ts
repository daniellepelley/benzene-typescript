import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IServiceResolver, serviceToken } from '@benzenejs/abstractions';
import { BenzeneResult } from '@benzenejs/results';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import {
  HealthCheckResponse,
  HealthCheckResult,
  HealthCheckStatus,
  IHealthCheck,
  IHealthCheckBuilder,
  SchemaHealthCheckConstants,
} from '@benzenejs/health-checks-core';
import {
  addContractCheck,
  addContractCheckInstance,
  ClientHashMatch,
  ClientHealthCheck,
  ClientHealthCheckProcessor,
  IHasHealthCheck,
} from '@benzenejs/clients-health-checks';

/**
 * Port-verification tests for `@benzenejs/clients-health-checks`. The C# package `Benzene.Clients.HealthChecks`
 * ships no test suite, so these are new tests that exercise the ported behaviour (contract-drift verdict,
 * status mapping, reachability) rather than a mirror of C# scenarios.
 */

/** A raw provider response carrying a `schema` health check that publishes `serviceHash`. */
function schemaResponse(serviceHash: string): HealthCheckResponse {
  const schema = new HealthCheckResult(
    HealthCheckStatus.ok,
    SchemaHealthCheckConstants.type,
    { [SchemaHealthCheckConstants.hashCodeKey]: serviceHash },
    [],
  );
  return new HealthCheckResponse(true, { [SchemaHealthCheckConstants.type]: schema });
}

/** A fake generated client returning a canned health response (or throwing). */
class FakeClient implements IHasHealthCheck {
  constructor(
    readonly hashCode: string,
    private readonly result: () => Promise<IBenzeneResultOf<HealthCheckResponse>>,
  ) {}

  healthCheckAsync(): Promise<IBenzeneResultOf<HealthCheckResponse>> {
    return this.result();
  }
}

describe('ClientHealthCheckProcessor', () => {
  it('process_MatchingHash_AnnotatesMatchTrue_AndKeepsOk', () => {
    const annotated = ClientHealthCheckProcessor.process(schemaResponse('abc'), 'abc');

    const schema = annotated.healthChecks[SchemaHealthCheckConstants.type]!;
    const match = schema.data[SchemaHealthCheckConstants.matchKey] as ClientHashMatch;
    expect(match.isMatch).toBe(true);
    expect(match.serviceHashCode).toBe('abc');
    expect(match.clientHashCode).toBe('abc');
    expect(schema.status).toBe(HealthCheckStatus.ok);
  });

  it('process_DriftingHash_AnnotatesMatchFalse_AndDegradesToWarning', () => {
    const annotated = ClientHealthCheckProcessor.process(schemaResponse('v2'), 'v1');

    const schema = annotated.healthChecks[SchemaHealthCheckConstants.type]!;
    const match = schema.data[SchemaHealthCheckConstants.matchKey] as ClientHashMatch;
    expect(match.isMatch).toBe(false);
    expect(match.serviceHashCode).toBe('v2');
    expect(schema.status).toBe(HealthCheckStatus.warning);
  });

  it('process_NoSchemaCheck_PassesResponseThroughUnannotated', () => {
    const database = new HealthCheckResult(HealthCheckStatus.ok, 'database', {}, []);
    const response = new HealthCheckResponse(true, { database });

    const result = ClientHealthCheckProcessor.process(response, 'v1');

    expect(result.healthChecks.database!.data[SchemaHealthCheckConstants.matchKey]).toBeUndefined();
  });
});

describe('ClientHealthCheck', () => {
  it('execute_ReachableMatchingContract_ReturnsOk', async () => {
    const annotated = ClientHealthCheckProcessor.process(schemaResponse('abc'), 'abc') as HealthCheckResponse;
    const client = new FakeClient('abc', () => Promise.resolve(BenzeneResult.ok(annotated)));

    const result = await new ClientHealthCheck('orders', client).executeAsync();

    expect(result.status).toBe(HealthCheckStatus.ok);
    expect(result.type).toBe('orders');
    expect(result.data.reachable).toBe(true);
    expect(result.data[SchemaHealthCheckConstants.matchKey]).toBeInstanceOf(ClientHashMatch);
    expect(result.dependencies).toEqual([{ kind: 'Service', name: 'orders' }]);
  });

  it('execute_ReachableDriftedContract_ReturnsWarning', async () => {
    const annotated = ClientHealthCheckProcessor.process(schemaResponse('v2'), 'v1') as HealthCheckResponse;
    const client = new FakeClient('v1', () => Promise.resolve(BenzeneResult.ok(annotated)));

    const result = await new ClientHealthCheck('orders', client).executeAsync();

    expect(result.status).toBe(HealthCheckStatus.warning);
    expect(result.data.reachable).toBe(true);
  });

  it('execute_ReachableNoSchemaCheck_ReturnsOkWithoutMatch', async () => {
    const database = new HealthCheckResult(HealthCheckStatus.ok, 'database', {}, []);
    const response = new HealthCheckResponse(true, { database });
    const client = new FakeClient('v1', () => Promise.resolve(BenzeneResult.ok(response)));

    const result = await new ClientHealthCheck('orders', client).executeAsync();

    expect(result.status).toBe(HealthCheckStatus.ok);
    expect(result.data.reachable).toBe(true);
    expect(result.data[SchemaHealthCheckConstants.matchKey]).toBeUndefined();
  });

  it('execute_UnreachableNullPayload_ReturnsFailed', async () => {
    const client = new FakeClient('v1', () =>
      Promise.resolve(BenzeneResult.serviceUnavailable<HealthCheckResponse>('down')),
    );

    const result = await new ClientHealthCheck('orders', client).executeAsync();

    expect(result.status).toBe(HealthCheckStatus.failed);
    expect(result.data.reachable).toBe(false);
    expect(result.data.errors).toEqual(['down']);
  });

  // --- W3.11 (R18 #298's ruling, the Go port's long-documented stance): a client-facing health
  // check reports the error's TYPE/category, never its message — a message can carry infra detail
  // (hostnames, connection strings) an unauthenticated health caller must never see. The raw error
  // reaches only the server-side onError log hook. -------------------------------------------------

  it('execute_ClientThrows_ReturnsFailed_ReportingTheErrorCategoryNeverTheMessage', async () => {
    const secret = 'connection refused to internal-db.prod.local:5432 as user admin';
    const client = new FakeClient('v1', () => Promise.reject(new Error(secret)));

    const result = await new ClientHealthCheck('orders', client).executeAsync();

    expect(result.status).toBe(HealthCheckStatus.failed);
    expect(result.data.reachable).toBe(false);
    expect(result.data.error).toBe('Error');
    // The whole health Data bag must be free of the exception's message text.
    expect(JSON.stringify(result.data)).not.toContain(secret);
    expect(JSON.stringify(result.data)).not.toContain('internal-db.prod.local');
  });

  it('execute_ClientThrowsACustomErrorClass_ReportsItsConstructorName', async () => {
    class UpstreamTimeoutError extends Error {}
    const client = new FakeClient('v1', () =>
      Promise.reject(new UpstreamTimeoutError('timed out after 30s talking to 10.0.0.5')),
    );

    const result = await new ClientHealthCheck('orders', client).executeAsync();

    expect(result.data.error).toBe('UpstreamTimeoutError');
    expect(JSON.stringify(result.data)).not.toContain('10.0.0.5');
  });

  it('execute_ClientThrowsANonError_ReportsItsTypeofNeverItsContent', async () => {
    // A thrown string's content is as leak-prone as a message — `String(ex)` must not be reported.
    const client = new FakeClient('v1', () => Promise.reject('creds=admin:hunter2'));

    const result = await new ClientHealthCheck('orders', client).executeAsync();

    expect(result.data.error).toBe('string');
    expect(JSON.stringify(result.data)).not.toContain('hunter2');
  });

  it('execute_ClientThrows_RawErrorReachesOnlyTheServerSideLogHook', async () => {
    const raw = new Error('connection refused to internal-db.prod.local:5432');
    const seen: unknown[] = [];
    const client = new FakeClient('v1', () => Promise.reject(raw));

    const result = await new ClientHealthCheck('orders', client, (error) => seen.push(error)).executeAsync();

    expect(seen).toEqual([raw]);
    expect(result.data.error).toBe('Error');
  });
});

describe('ContractHealthCheckExtensions', () => {
  it('addContractCheckInstance_RegistersAClientHealthCheckForTheService', async () => {
    const annotated = ClientHealthCheckProcessor.process(schemaResponse('abc'), 'abc') as HealthCheckResponse;
    const client = new FakeClient('abc', () => Promise.resolve(BenzeneResult.ok(annotated)));
    const builder = new CapturingBuilder();

    addContractCheckInstance(builder, 'orders', client);
    const checks = builder.getHealthChecks(new DefaultBenzeneServiceContainer().createServiceResolverFactory().createScope());

    expect(checks).toHaveLength(1);
    expect(checks[0]!.type).toBe('orders');
    expect((await checks[0]!.executeAsync()).status).toBe(HealthCheckStatus.ok);
  });

  it('addContractCheck_ResolvesTheClientFromTheContainer', async () => {
    const annotated = ClientHealthCheckProcessor.process(schemaResponse('abc'), 'abc') as HealthCheckResponse;
    const client = new FakeClient('abc', () => Promise.resolve(BenzeneResult.ok(annotated)));
    const IOrdersClient = serviceToken<IHasHealthCheck>('IOrdersClient');

    const container = new DefaultBenzeneServiceContainer();
    container.addSingletonInstance(IOrdersClient, client);
    const builder = new CapturingBuilder();

    addContractCheck(builder, 'orders', IOrdersClient);
    const checks = builder.getHealthChecks(container.createServiceResolverFactory().createScope());

    expect(checks).toHaveLength(1);
    expect((await checks[0]!.executeAsync()).status).toBe(HealthCheckStatus.ok);
  });
});

/** A minimal `IHealthCheckBuilder` that just captures registered factory functions, for exercising the extensions. */
class CapturingBuilder implements IHealthCheckBuilder {
  private readonly factories: Array<(resolver: IServiceResolver) => IHealthCheck> = [];

  addHealthCheck(): IHealthCheckBuilder {
    throw new Error('not used in these tests');
  }

  addHealthCheckFn(func: (resolver: IServiceResolver) => IHealthCheck): IHealthCheckBuilder {
    this.factories.push(func);
    return this;
  }

  getHealthChecks(resolver: IServiceResolver): IHealthCheck[] {
    return this.factories.map((f) => f(resolver));
  }
}
