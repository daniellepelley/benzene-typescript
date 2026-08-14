/** Port of the connection-check half of Benzene.HealthChecks.EntityFramework's factory/registration. */
import { IServiceResolver } from '@benzenejs/abstractions';
import { IHealthCheck, IHealthCheckFactory } from '@benzenejs/health-checks-core';
import { DatabaseConnectionHealthCheck } from './DatabaseConnectionHealthCheck';
import { ITypeOrmDatabase } from './TypeOrmDatabase';

/**
 * Builds a {@link DatabaseConnectionHealthCheck} for a fixed database.
 *
 * PORT DIVERGENCE: the C# registration resolves `TDbContext` from the container in `Create` (a fresh,
 * scoped context each run); the TypeScript port has no DI token for an arbitrary `DataSource`/ORM handle,
 * so the {@link ITypeOrmDatabase} is supplied to the factory directly and `create`'s resolver is unused —
 * the same convention as the DynamoDb/SQS health-check factories.
 */
export class DatabaseConnectionHealthCheckFactory implements IHealthCheckFactory {
  constructor(
    private readonly database: ITypeOrmDatabase,
    private readonly name: string,
  ) {}

  create(_resolver: IServiceResolver): IHealthCheck {
    return new DatabaseConnectionHealthCheck(this.database, this.name);
  }
}
