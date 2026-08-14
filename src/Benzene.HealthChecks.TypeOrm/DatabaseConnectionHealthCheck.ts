/** Port of Benzene.HealthChecks.EntityFramework.DatabaseConnectionHealthCheck, adapted to TypeORM. */
import {
  HealthCheckDependency,
  HealthCheckResult,
  IHealthCheck,
  IHealthCheckResult,
} from '@benzenejs/health-checks-core';
import { errorName, ITypeOrmDatabase } from './TypeOrmDatabase';

/**
 * Checks only that the database can connect — unlike {@link DatabaseHealthCheck}, it does not also verify
 * the applied migration.
 *
 * `TDbContext` generic → an injected {@link ITypeOrmDatabase} (the `DbContext.Database` analog) plus a
 * `name` for the dependency label (TypeScript erases the context type EF used for both DI resolution and
 * the label, so the name is passed explicitly).
 */
export class DatabaseConnectionHealthCheck implements IHealthCheck {
  constructor(
    private readonly database: ITypeOrmDatabase,
    private readonly name: string,
  ) {}

  get type(): string {
    return 'DatabaseConnection';
  }

  /**
   * Checks connectivity via {@link ITypeOrmDatabase.canConnect}. The result's data includes `CanConnect`
   * and `Error` (the connection failure's type name, if any — not its message, since some drivers include
   * connection details such as server/credentials in exception messages, and this result can flow out to
   * whatever calls the health check topic with no built-in authorization).
   */
  async executeAsync(): Promise<IHealthCheckResult> {
    const dependencies = [new HealthCheckDependency('Database', this.name)];
    const [canConnect, error] = await this.tryConnect();

    return HealthCheckResult.createInstance(
      canConnect,
      this.type,
      { CanConnect: canConnect, Error: error === undefined ? undefined : errorName(error) },
      dependencies,
    );
  }

  private async tryConnect(): Promise<[boolean, unknown]> {
    try {
      return [await this.database.canConnect(), undefined];
    } catch (error) {
      return [false, error];
    }
  }
}
