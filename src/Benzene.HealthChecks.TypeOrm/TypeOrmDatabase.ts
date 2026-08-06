/** The TypeORM analog of EF Core's `DbContext.Database` facade, for the health checks to read. */
import { DataSource, MigrationExecutor } from 'typeorm';

/**
 * The two capabilities the database health checks need — the analog of the members
 * `Benzene.HealthChecks.EntityFramework` reads off `DbContext.Database`
 * (`CanConnectAsync` / `GetAppliedMigrationsAsync`). Abstracted as an interface so the checks are unit
 * testable without a live database and, if ever needed, retargetable to another ORM.
 */
export interface ITypeOrmDatabase {
  /**
   * Whether the database is reachable. The analog of EF's `Database.CanConnectAsync()`; may reject if the
   * probe itself errors (the health check treats a rejection as "cannot connect" and records the error
   * type).
   */
  canConnect(): Promise<boolean>;

  /**
   * The applied migration names in ascending order (oldest first, so the last element is the most
   * recently applied). The analog of EF's `Database.GetAppliedMigrationsAsync()`.
   */
  getAppliedMigrations(): Promise<string[]>;
}

/**
 * Default {@link ITypeOrmDatabase} backed by a TypeORM {@link DataSource} — the concrete stand-in for
 * `DbContext.Database`.
 *
 * ADAPTATION: EF's `CanConnectAsync()` opens a connection and returns a bool; TypeORM's `DataSource` has
 * no such method, so connectivity is probed with a trivial `SELECT 1`. Unlike EF (which can return `false`
 * without throwing), the probe query either succeeds or *throws*, so a connection failure always surfaces
 * as a rejection — the health check records it as `CanConnect: false` with the error type. EF's
 * `GetAppliedMigrationsAsync()` maps to TypeORM's `MigrationExecutor.getExecutedMigrations()` (the
 * DB-agnostic applied-migrations API), re-sorted ascending by timestamp so the ordering + "last applied"
 * semantics match EF.
 */
export class DataSourceTypeOrmDatabase implements ITypeOrmDatabase {
  constructor(private readonly dataSource: DataSource) {}

  async canConnect(): Promise<boolean> {
    await this.dataSource.query('SELECT 1');
    return true;
  }

  async getAppliedMigrations(): Promise<string[]> {
    const migrations = await new MigrationExecutor(this.dataSource).getExecutedMigrations();
    return migrations
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((migration) => migration.name);
  }
}

/** Mirrors C#'s `ex.GetType().Name` — the constructor name of the thrown value (never its message). */
export function errorName(error: unknown): string {
  if (error instanceof Error) {
    return error.name;
  }
  return typeof error;
}
