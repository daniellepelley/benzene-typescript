/**
 * Per-service health checks for the AWS Lambda mesh, mirroring .NET's `examples/AwsMesh/<Service>/HealthChecks`
 * one-for-one: each is a plain {@link IHealthCheck} declaring the external dependency it verifies and a
 * little diagnostic `data`. Registered per service in {@link file://./services.ts} and run by the real
 * `@benzenejs/health-checks` middleware on the reserved `benzene:healthcheck` topic (see
 * {@link file://./meshService.ts}), so every `services/{name}.json` the mesh writes carries a genuine
 * `HealthCheckResponse` — `{ isHealthy, healthChecks: { <type>: { status, type, data, dependencies } } }` —
 * which is exactly what the cross-language Mesh UI renders per service and per check.
 *
 * The checks are illustrative (all healthy, with fixed latencies) — a real service would actually probe
 * its database/queue/HTTP dependency here and report a failed or warning result — but the *shapes*,
 * `type`s, and `dependencies` match the .NET demo so the two ports produce an identical estate.
 */
import { IHealthCheck } from '@benzenejs/health-checks-core';
import { HealthCheckDependency, HealthCheckResult, IHealthCheckResult } from '@benzenejs/health-checks-core';

// --- orders-api -----------------------------------------------------------------------------------

/** A healthy Postgres check for orders-api, declaring a dependency on the orders-db database. */
export class OrdersDatabaseHealthCheck implements IHealthCheck {
  private static readonly dependencies = [new HealthCheckDependency('Database', 'orders-db')];
  readonly type = 'PostgresDatabase';
  executeAsync(): Promise<IHealthCheckResult> {
    return Promise.resolve(HealthCheckResult.createInstance(true, this.type, { latencyMs: 4 }, OrdersDatabaseHealthCheck.dependencies));
  }
}

/** A healthy SQS check for orders-api, declaring a dependency on the order-events queue. */
export class OrdersQueueHealthCheck implements IHealthCheck {
  private static readonly dependencies = [new HealthCheckDependency('Queue', 'order-events')];
  readonly type = 'SqsQueue';
  executeAsync(): Promise<IHealthCheckResult> {
    return Promise.resolve(HealthCheckResult.createInstance(true, this.type, { approxDepth: 0 }, OrdersQueueHealthCheck.dependencies));
  }
}

// --- payments-api ---------------------------------------------------------------------------------

/** A healthy Postgres check for payments-api, depending on the payments-db database. */
export class PaymentsDatabaseHealthCheck implements IHealthCheck {
  private static readonly dependencies = [new HealthCheckDependency('Database', 'payments-db')];
  readonly type = 'PostgresDatabase';
  executeAsync(): Promise<IHealthCheckResult> {
    return Promise.resolve(HealthCheckResult.createInstance(true, this.type, { latencyMs: 6 }, PaymentsDatabaseHealthCheck.dependencies));
  }
}

/** A healthy check for the upstream payment gateway payments-api calls out to. */
export class PaymentsGatewayHealthCheck implements IHealthCheck {
  private static readonly dependencies = [new HealthCheckDependency('Http', 'stripe-gateway')];
  readonly type = 'PaymentGateway';
  executeAsync(): Promise<IHealthCheckResult> {
    return Promise.resolve(HealthCheckResult.createInstance(true, this.type, { provider: 'stripe' }, PaymentsGatewayHealthCheck.dependencies));
  }
}

// --- shipping-api ---------------------------------------------------------------------------------

/** A healthy DynamoDB check for shipping-api, depending on the shipments table. */
export class ShippingDatabaseHealthCheck implements IHealthCheck {
  private static readonly dependencies = [new HealthCheckDependency('Database', 'shipments-table')];
  readonly type = 'DynamoDbTable';
  executeAsync(): Promise<IHealthCheckResult> {
    return Promise.resolve(HealthCheckResult.createInstance(true, this.type, { latencyMs: 3 }, ShippingDatabaseHealthCheck.dependencies));
  }
}

/** A healthy check for the downstream carrier API shipping-api integrates with. */
export class CarrierApiHealthCheck implements IHealthCheck {
  private static readonly dependencies = [new HealthCheckDependency('Http', 'carrier-api')];
  readonly type = 'CarrierApi';
  executeAsync(): Promise<IHealthCheckResult> {
    return Promise.resolve(HealthCheckResult.createInstance(true, this.type, { carriers: 'DPD,RoyalMail' }, CarrierApiHealthCheck.dependencies));
  }
}

// --- inventory-api --------------------------------------------------------------------------------

/** A healthy Postgres check for inventory-api, declaring a dependency on the inventory-db database. */
export class InventoryDatabaseHealthCheck implements IHealthCheck {
  private static readonly dependencies = [new HealthCheckDependency('Database', 'inventory-db')];
  readonly type = 'PostgresDatabase';
  executeAsync(): Promise<IHealthCheckResult> {
    return Promise.resolve(HealthCheckResult.createInstance(true, this.type, { latencyMs: 5 }, InventoryDatabaseHealthCheck.dependencies));
  }
}

// --- notifications-api ----------------------------------------------------------------------------

/** A healthy check for notifications-api's outbound email provider, declaring a dependency on it. */
export class EmailProviderHealthCheck implements IHealthCheck {
  private static readonly dependencies = [new HealthCheckDependency('Http', 'email-provider')];
  readonly type = 'HttpDependency';
  executeAsync(): Promise<IHealthCheckResult> {
    return Promise.resolve(HealthCheckResult.createInstance(true, this.type, { latencyMs: 18 }, EmailProviderHealthCheck.dependencies));
  }
}

// --- analytics-api --------------------------------------------------------------------------------

/** A healthy check for analytics-api's metrics store, declaring a dependency on the warehouse. */
export class AnalyticsStoreHealthCheck implements IHealthCheck {
  private static readonly dependencies = [new HealthCheckDependency('Database', 'analytics-warehouse')];
  readonly type = 'TimeseriesStore';
  executeAsync(): Promise<IHealthCheckResult> {
    return Promise.resolve(HealthCheckResult.createInstance(true, this.type, { latencyMs: 9 }, AnalyticsStoreHealthCheck.dependencies));
  }
}
