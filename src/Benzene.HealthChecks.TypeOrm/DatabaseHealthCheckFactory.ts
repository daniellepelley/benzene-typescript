/** Port of Benzene.HealthChecks.EntityFramework.DatabaseHealthCheckFactory, adapted to TypeORM. */
import { IServiceResolver } from '@benzenejs/abstractions';
import { IHealthCheck, IHealthCheckFactory } from '@benzenejs/health-checks-core';
import { DatabaseHealthCheck } from './DatabaseHealthCheck';
import { ITypeOrmDatabase } from './TypeOrmDatabase';

/**
 * Builds a {@link DatabaseHealthCheck} for a fixed target migration.
 *
 * PORT DIVERGENCE: the C# factory resolves `TDbContext` from the container in `Create` (a fresh, scoped
 * context each run); the TypeScript port has no DI token for an arbitrary `DataSource`/ORM handle, so the
 * {@link ITypeOrmDatabase} is supplied to the factory directly and `create`'s resolver is unused — the same
 * convention as the DynamoDb/SQS health-check factories.
 */
export class DatabaseHealthCheckFactory implements IHealthCheckFactory {
  constructor(
    private readonly database: ITypeOrmDatabase,
    private readonly targetMigration: string,
    private readonly name: string,
  ) {}

  create(_resolver: IServiceResolver): IHealthCheck {
    return new DatabaseHealthCheck(this.database, this.targetMigration, this.name);
  }
}
