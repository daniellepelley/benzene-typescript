/**
 * TypeScript port of Benzene.HealthChecks.EntityFramework — database health checks, adapted to **TypeORM**
 * (the structural analog of EF Core: a `DataSource` in place of a `DbContext`, a migrations table, a
 * DB-agnostic applied-migrations API).
 *
 * `addDatabaseConnectionHealthCheck(builder, dataSource)` verifies connectivity only;
 * `addDatabaseHealthCheck(builder, dataSource, targetMigration)` additionally verifies that
 * `targetMigration` is the LAST applied migration. Both report the same diagnostic shape as the .NET
 * original (`CanConnect`, `AppliedMigrations`, `MigrationMatch`, …), with error *types* only (never
 * messages, which drivers may fill with connection details).
 *
 * ADAPTATION: EF's `DbContext.Database.CanConnectAsync()` / `GetAppliedMigrationsAsync()` become
 * {@link ITypeOrmDatabase} (`canConnect()` via a `SELECT 1` probe; `getAppliedMigrations()` via TypeORM's
 * `MigrationExecutor`). The C# resolves `TDbContext` from DI each run; the port has no DI token for an
 * arbitrary `DataSource`, so it is supplied to the `add*` helpers directly (the DynamoDb/SQS health-check
 * convention). Documented in the README porting-conventions table.
 */
export * from './TypeOrmDatabase';
export * from './DatabaseConnectionHealthCheck';
export * from './DatabaseHealthCheck';
export * from './DatabaseConnectionHealthCheckFactory';
export * from './DatabaseHealthCheckFactory';
export * from './Extensions';
