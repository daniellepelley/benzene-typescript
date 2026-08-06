/** Port of Benzene.HealthChecks.EntityFramework.Extensions, adapted to TypeORM. */
import { DataSource } from 'typeorm';
import { addHealthCheckFactory, IHealthCheckBuilder } from '@benzene/health-checks-core';
import { DataSourceTypeOrmDatabase } from './TypeOrmDatabase';
import { DatabaseConnectionHealthCheckFactory } from './DatabaseConnectionHealthCheckFactory';
import { DatabaseHealthCheckFactory } from './DatabaseHealthCheckFactory';

/**
 * Registration helpers for the TypeORM health checks, for parity with the other providers' `add*`
 * helpers (C# extension methods → free functions taking the builder first). Both accept a TypeORM
 * {@link DataSource} directly — the port has no DI token for it, so it is supplied here rather than
 * resolved from the container (mirroring the DynamoDb/SQS health-check helpers).
 */

/**
 * Registers a {@link DatabaseHealthCheck} that verifies connectivity AND that `targetMigration` is the last
 * applied migration.
 *
 * @param builder The health check builder to register against.
 * @param dataSource The TypeORM data source to check.
 * @param targetMigration The migration name expected to be the last one applied (TypeORM migration class
 *   name, e.g. `Initial1700000000000`).
 * @param name Dependency label for the result; defaults to the data source's database name.
 */
export function addDatabaseHealthCheck(
  builder: IHealthCheckBuilder,
  dataSource: DataSource,
  targetMigration: string,
  name: string = databaseName(dataSource),
): IHealthCheckBuilder {
  return addHealthCheckFactory(
    builder,
    new DatabaseHealthCheckFactory(new DataSourceTypeOrmDatabase(dataSource), targetMigration, name),
  );
}

/**
 * Registers a {@link DatabaseConnectionHealthCheck} that verifies only that the data source can connect (no
 * migration check).
 *
 * @param builder The health check builder to register against.
 * @param dataSource The TypeORM data source to check.
 * @param name Dependency label for the result; defaults to the data source's database name.
 */
export function addDatabaseConnectionHealthCheck(
  builder: IHealthCheckBuilder,
  dataSource: DataSource,
  name: string = databaseName(dataSource),
): IHealthCheckBuilder {
  return addHealthCheckFactory(
    builder,
    new DatabaseConnectionHealthCheckFactory(new DataSourceTypeOrmDatabase(dataSource), name),
  );
}

/** The data source's database name when it is a plain string (the common case), else a generic label. */
function databaseName(dataSource: DataSource): string {
  const database = dataSource.options.database;
  return typeof database === 'string' ? database : 'Database';
}
