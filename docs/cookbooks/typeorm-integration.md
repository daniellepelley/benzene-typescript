# TypeORM Integration

Use [TypeORM](https://typeorm.io/) for data access in a Benzene service — injected into your handlers the
standard way — and add a database health check with `@benzenejs/health-checks-typeorm`.

## Problem Statement

You want to:

- Access a database from message handlers using TypeORM.
- Keep data access behind a port so handlers stay testable and portable.
- Expose a health check that verifies the database connection (and, optionally, that migrations are
  applied).

> **Port note.** The .NET original uses EF Core and `Benzene.HealthChecks.EntityFramework`. Per the port's
> [third-party-integration convention](../../README.md#porting-conventions), the TypeScript port adapts to
> **TypeORM**: a `DataSource` stands in for EF's `DbContext`, and `@benzenejs/health-checks-typeorm` ports the
> EF health checks (`SELECT 1` for connectivity; TypeORM's `MigrationExecutor` for applied migrations).

## Prerequisites

- [Node.js 22+](https://nodejs.org/) and a Benzene service.
- TypeORM and a database driver (`pg` for PostgreSQL, `mysql2`, …).
- `@benzenejs/health-checks-typeorm` for the health check.

```bash
npm install typeorm pg
npm install @benzenejs/health-checks-typeorm @benzenejs/health-checks
```

`@benzenejs/health-checks-typeorm` depends on `typeorm` directly.

## Step-by-Step Implementation

### 1. Define your entity

This example uses TypeORM's [`EntitySchema`](https://typeorm.io/separating-entity-definition), which needs
**no decorators** — so your project keeps Benzene's standard-decorator tsconfig (`@message`/`@httpEndpoint`
are TC39 decorators; TypeORM's `@Entity`/`@Column` are legacy decorators requiring `experimentalDecorators`,
which would otherwise conflict — see [Variations](#use-decorator-entities)):

```ts
// OrderEntity.ts
import { EntitySchema } from 'typeorm';

export interface OrderRow {
  id: string;
  customerId: string;
}

export const OrderEntity = new EntitySchema<OrderRow>({
  name: 'order',
  tableName: 'orders',
  columns: {
    id: { type: String, primary: true },
    customerId: { type: String },
  },
});
```

### 2. Keep data access behind a port

Rather than injecting the `DataSource` straight into handlers, put it behind a repository interface (a
"port") with a merged `ServiceToken`. This keeps handlers ignorant of TypeORM and easy to test:

```ts
// OrderRepository.ts
import { DataSource } from 'typeorm';
import { IBenzeneResultOf, ServiceToken, serviceToken } from '@benzenejs/abstractions';
import { BenzeneResult } from '@benzenejs/results';
import { OrderEntity } from './OrderEntity.js';

export class OrderDto {
  id?: string;
  customerId?: string;
}

export interface IOrderRepository {
  getAsync(id: string): Promise<IBenzeneResultOf<OrderDto>>;
}
export const IOrderRepository: ServiceToken<IOrderRepository> =
  serviceToken<IOrderRepository>('IOrderRepository');

// A container token for the shared DataSource (the port has no built-in DI token for it).
export const OrdersDataSource: ServiceToken<DataSource> = serviceToken<DataSource>('OrdersDataSource');

export class TypeOrmOrderRepository implements IOrderRepository {
  static readonly inject = [OrdersDataSource] as const;

  constructor(private readonly dataSource: DataSource) {}

  async getAsync(id: string): Promise<IBenzeneResultOf<OrderDto>> {
    const order = await this.dataSource.getRepository(OrderEntity).findOneBy({ id });
    return order === null
      ? BenzeneResult.notFound<OrderDto>()
      : BenzeneResult.ok<OrderDto>({ id: order.id, customerId: order.customerId });
  }
}
```

Handlers then depend only on `IOrderRepository` — no TypeORM types leak into your logic:

```ts
// handlers.ts
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { message } from '@benzenejs/core-message-handlers';
import { httpEndpoint } from '@benzenejs/http';
import { IOrderRepository, OrderDto } from './OrderRepository.js';

export class GetOrderRequest {
  id?: string;
}

@httpEndpoint('GET', '/orders/{id}')
@message('order:get', { requestType: GetOrderRequest, responseType: OrderDto })
export class GetOrderHandler implements IMessageHandler<GetOrderRequest, OrderDto> {
  static readonly inject = [IOrderRepository] as const;

  constructor(private readonly orders: IOrderRepository) {}

  handleAsync(request: GetOrderRequest): Promise<IBenzeneResultOf<OrderDto>> {
    return this.orders.getAsync(request.id!);
  }
}
```

### 3. Create and initialize the DataSource

A TypeORM `DataSource` owns the connection pool. Create it once and `initialize()` it before first use.
Register it as a **singleton instance** (one pool shared across the process) and the repository as
**scoped** (a fresh repository per message — but reading the same pool):

```ts
// index.ts
import { DataSource } from 'typeorm';
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneConfiguration, BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { addBenzene, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { AwsLambdaHost, useAwsLambda } from '@benzenejs/aws-lambda-core';
import { useApiGateway } from '@benzenejs/aws-lambda-api-gateway';
import { OrderEntity } from './OrderEntity.js';
import { IOrderRepository, OrdersDataSource, TypeOrmOrderRepository } from './OrderRepository.js';
import { GetOrderHandler } from './handlers.js';

const dataSource = new DataSource({
  type: 'postgres',
  url: process.env.DB_CONNECTION_STRING,
  entities: [OrderEntity],
});

// Initialize the pool once, on cold start. `initialize()` is idempotent-safe to await once here.
await dataSource.initialize();

export class StartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer, _config: BenzeneConfiguration): void {
    addBenzene(services);
    services.addSingletonInstance(OrdersDataSource, dataSource);
    services.addScoped(IOrderRepository, TypeOrmOrderRepository);
  }

  configure(app: IBenzeneApplicationBuilder, _config: BenzeneConfiguration): void {
    useAwsLambda(app, (aws) => useApiGateway(aws, (api) => useMessageHandlers(api, GetOrderHandler)));
  }
}

export const handler = new AwsLambdaHost(StartUp).lambdaHandler;
```

The registration is identical on any host — this example uses AWS Lambda; on
[Express](../getting-started.md) you'd register the same tokens on the container you pass to `benzene(...)`.

> **Request binding.** The TypeScript port binds the request **body**, not path segments (unlike .NET), so
> `order:get` reads `id` from the body; the `@httpEndpoint('GET', '/orders/{id}')` route still matches the
> URL. See [AWS Lambda Setup](../getting-started-aws.md).

### 4. Add a database health check

`@benzenejs/health-checks-typeorm` provides two checks over a `DataSource`, both taking it directly (the port
has no DI token for an arbitrary data source, so it's supplied to the `add*` helper). Wire them into a
[health-check](../health-checks.md) topic:

```ts
import { useHealthCheck } from '@benzenejs/health-checks';
import {
  addDatabaseConnectionHealthCheck,
  addDatabaseHealthCheck,
} from '@benzenejs/health-checks-typeorm';

.configure((app) =>
  useApiGateway(app, (api) => {
    useHealthCheck(api, 'benzene:healthcheck', (checks) => {
      addDatabaseConnectionHealthCheck(checks, dataSource);                // reachable? (SELECT 1)
      addDatabaseHealthCheck(checks, dataSource, 'Initial1700000000000');  // reachable AND on this migration?
    });
    useMessageHandlers(api, GetOrderHandler);
  }),
)
```

- `addDatabaseConnectionHealthCheck(checks, dataSource)` — **connectivity only**: a trivial `SELECT 1`;
  `type` is `'DatabaseConnection'`; `data` includes `CanConnect` and, on failure, `Error` (the error's
  type name — never its message, which drivers may fill with connection details).
- `addDatabaseHealthCheck(checks, dataSource, targetMigration)` — stricter: healthy only if the database
  connects **and** `targetMigration` is the **last** applied migration (TypeORM migration class name, e.g.
  `Initial1700000000000`). A database that connects fine but is behind on migrations reports unhealthy.

See [Health Checks: TypeORM](../health-checks.md#databaseconnectionhealthcheck--databasehealthcheck-benzenejshealth-checks-typeorm).

## Testing

Because handlers depend on `IOrderRepository`, unit-test them with a mocked repository — no database
needed:

```ts
// test/getOrder.test.ts
import { describe, expect, it } from 'vitest';
import { BenzeneResult } from '@benzenejs/results';
import { GetOrderHandler, GetOrderRequest } from '../src/handlers.js';
import { IOrderRepository, OrderDto } from '../src/OrderRepository.js';

describe('GetOrderHandler', () => {
  it('returns the order from the repository', async () => {
    const repo: IOrderRepository = {
      getAsync: (id) => Promise.resolve(BenzeneResult.ok<OrderDto>({ id, customerId: 'acme' })),
    };
    const handler = new GetOrderHandler(repo);

    const request = new GetOrderRequest();
    request.id = '123';
    const result = await handler.handleAsync(request);

    expect(result.payload).toEqual({ id: '123', customerId: 'acme' });
  });

  it('surfaces a not-found when the row is missing', async () => {
    const repo: IOrderRepository = {
      getAsync: () => Promise.resolve(BenzeneResult.notFound<OrderDto>()),
    };
    const handler = new GetOrderHandler(repo);

    const result = await handler.handleAsync(new GetOrderRequest());

    expect(result.isSuccessful).toBe(false);
  });
});
```

For **repository** tests, point a `DataSource` at SQLite (`type: 'sqlite'`, `database: ':memory:'`) or a
real database in Docker, `synchronize: true` (tests only), and exercise `TypeOrmOrderRepository` directly.
See [Mocking External Dependencies](mocking-dependencies.md).

## Troubleshooting

### `DataSource` "not initialized" errors

TypeORM throws if you query a `DataSource` before `await dataSource.initialize()`. Initialize it once at
startup (as in step 3) — before `build()` — so the pool is ready for the first request and the health
check.

### Connection-pool exhaustion on serverless

A `DataSource` is a singleton pool; don't create one per message. On serverless, keep the pool **small**
(`extra: { max: 2 }` for `pg`) since many concurrent Lambda instances each hold their own pool, and enable
driver-level retry where your driver supports it.

### Cold-start latency from the first query

The pool connect and first query happen on cold start / first use. See
[Lambda Cold Start Optimization](lambda-cold-start-optimization.md) — in particular, keeping
`configureServices` cheap and letting the pool warm on first use rather than doing heavy eager work.

### The migration check always reports unhealthy

`addDatabaseHealthCheck` checks that `targetMigration` is the **last** applied migration (not merely
present). If you're behind (or ahead of) the expected migration it reports unhealthy — confirm the exact
TypeORM migration class name and that migrations ran. Use `addDatabaseConnectionHealthCheck` alone if you
only care about connectivity.

## Variations

### Use decorator entities

If you prefer TypeORM's `@Entity`/`@Column` decorator model, enable `experimentalDecorators` and
`emitDecoratorMetadata` in your `tsconfig.json` (TypeORM's standard setup) and `import 'reflect-metadata'`
at your entry point. Benzene's `@message`/`@httpEndpoint` decorators are written to work under legacy
decorator mode too, so the two coexist. The `EntitySchema` approach above avoids the tsconfig change
entirely, which is why this cookbook defaults to it.

### Add caching in front of the database

Layer [Redis caching](redis-caching.md) inside the repository so hot reads skip the database — the cache
sits cleanly in front of the `IOrderRepository` port.

### Run migrations at deploy time

Run TypeORM migrations as part of deployment rather than at startup on serverless hosts, and use
`addDatabaseHealthCheck(checks, dataSource, targetMigration)` to detect drift between the deployed schema
and the code.

## Further Reading

- [Health Checks](../health-checks.md) — the health-check pipeline and the TypeORM check reference.
- [Redis Caching](redis-caching.md) — caching reads in front of the database.
- [Message Handlers](../message-handlers.md) — keeping handlers thin and port-based.
- [Mocking External Dependencies](mocking-dependencies.md) — testing handlers with a mocked repository.
- [Lambda Cold Start Optimization](lambda-cold-start-optimization.md) — pool init and cold-start cost.
