/** Port of Benzene.HealthChecks.EntityFramework.DatabaseHealthCheck, adapted to TypeORM. */
import {
  HealthCheckDependency,
  HealthCheckResult,
  IHealthCheck,
  IHealthCheckResult,
} from '@benzenejs/health-checks-core';
import { errorName, ITypeOrmDatabase } from './TypeOrmDatabase';

/**
 * Checks both that the database can connect AND that its schema is on the expected migration — healthy
 * only if the connection succeeds and `targetMigration` is the LAST applied migration (not merely present
 * among applied migrations). A stricter check than {@link DatabaseConnectionHealthCheck}: a database that
 * connects fine but hasn't had a newer migration applied (or has one newer than expected) reports
 * unhealthy.
 */
export class DatabaseHealthCheck implements IHealthCheck {
  constructor(
    private readonly database: ITypeOrmDatabase,
    private readonly targetMigration: string,
    private readonly name: string,
  ) {}

  get type(): string {
    return 'Database';
  }

  /**
   * Checks connectivity and applied migrations. The result's data includes `CanConnect`,
   * `AppliedMigrations`, `TargetMigration`, `MigrationMatch` (whether the target is the last applied one —
   * this drives pass/fail), `MigrationContains` (whether it's applied at all, regardless of position),
   * `Error` (the connection failure's type name, if any), and `MigrationError` (the migration query's
   * failure type, if any). Error *types* only, never messages — some drivers include connection details in
   * exception messages and this result can flow out with no built-in authorization.
   */
  async executeAsync(): Promise<IHealthCheckResult> {
    const dependencies = [new HealthCheckDependency('Database', this.name)];
    const [canConnect, connectError] = await this.tryConnect();
    const [appliedMigrations, migrationError] = await this.tryGetAppliedMigrations();

    const migrationContains = appliedMigrations.includes(this.targetMigration);
    const migrationMatch = appliedMigrations[appliedMigrations.length - 1] === this.targetMigration;

    // A migration query that *threw* is distinct from "connected but behind": both report
    // MigrationMatch=false, but only the former sets MigrationError, so an operator can tell a
    // transient/driver error apart from a genuinely un-migrated database. The check is unhealthy if it
    // can't connect, if the migration query failed, or if the target isn't the last applied migration.
    const isHealthy = canConnect && migrationError === undefined && migrationMatch;

    return HealthCheckResult.createInstance(
      isHealthy,
      this.type,
      {
        CanConnect: canConnect,
        AppliedMigrations: appliedMigrations,
        TargetMigration: this.targetMigration,
        MigrationMatch: migrationMatch,
        MigrationContains: migrationContains,
        Error: connectError === undefined ? undefined : errorName(connectError),
        MigrationError: migrationError === undefined ? undefined : errorName(migrationError),
      },
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

  private async tryGetAppliedMigrations(): Promise<[string[], unknown]> {
    try {
      return [await this.database.getAppliedMigrations(), undefined];
    } catch (error) {
      // Report the failure type rather than silently returning "no migrations applied", which is
      // indistinguishable from a genuinely un-migrated database.
      return [[], error];
    }
  }
}
