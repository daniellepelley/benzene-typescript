import { describe, expect, it } from 'vitest';
import { HealthCheckStatus } from '@benzene/health-checks-core';
import {
  DatabaseConnectionHealthCheck,
  DatabaseHealthCheck,
  ITypeOrmDatabase,
} from '@benzene/health-checks-typeorm';

/**
 * Ports test/Benzene.Core.Test/HealthChecks/EntityFramework/DatabaseConnectionHealthCheckTest.cs +
 * DatabaseHealthCheckTest.cs. The C# tests use the EF InMemory provider (which cannot do migrations, so it
 * can only exercise the failure paths); the TypeORM port drives a fake {@link ITypeOrmDatabase}, so it also
 * covers the healthy "connects AND target is the last applied migration" path.
 */

class FakeDatabase implements ITypeOrmDatabase {
  constructor(
    private readonly opts: { connect?: boolean | Error; migrations?: string[] | Error } = {},
  ) {}

  canConnect(): Promise<boolean> {
    const connect = this.opts.connect ?? true;
    return connect instanceof Error ? Promise.reject(connect) : Promise.resolve(connect);
  }

  getAppliedMigrations(): Promise<string[]> {
    const migrations = this.opts.migrations ?? [];
    return migrations instanceof Error ? Promise.reject(migrations) : Promise.resolve(migrations);
  }
}

describe('DatabaseConnectionHealthCheck', () => {
  it('returns healthy when it can connect', async () => {
    const result = await new DatabaseConnectionHealthCheck(new FakeDatabase(), 'orders').executeAsync();

    expect(result.status).toBe(HealthCheckStatus.ok);
    expect(result.type).toBe('DatabaseConnection');
    expect(result.data.CanConnect).toBe(true);
    expect(result.data.Error).toBeUndefined();
    expect(result.dependencies).toHaveLength(1);
    expect(result.dependencies[0]!.kind).toBe('Database');
    expect(result.dependencies[0]!.name).toBe('orders');
  });

  it('returns failed when the connection throws', async () => {
    const database = new FakeDatabase({ connect: new Error('boom') });
    const result = await new DatabaseConnectionHealthCheck(database, 'orders').executeAsync();

    expect(result.status).toBe(HealthCheckStatus.failed);
    expect(result.data.CanConnect).toBe(false);
    expect(result.data.Error).toBeDefined();
  });

  it('has type DatabaseConnection', () => {
    expect(new DatabaseConnectionHealthCheck(new FakeDatabase(), 'orders').type).toBe('DatabaseConnection');
  });

  it('records the error TYPE name (C# GetType().Name), not the inherited "Error", for a subclass', async () => {
    // A subclass that never sets `.name` inherits "Error"; the check must still report its class name,
    // matching C#'s `ex.GetType().Name`.
    class ConnectionRefusedError extends Error {}
    const database = new FakeDatabase({ connect: new ConnectionRefusedError('refused') });
    const result = await new DatabaseConnectionHealthCheck(database, 'orders').executeAsync();

    expect(result.data.Error).toBe('ConnectionRefusedError');
  });
});

describe('DatabaseHealthCheck', () => {
  const target = 'Initial1700000000000';

  it('returns healthy when it connects and the target is the last applied migration', async () => {
    const database = new FakeDatabase({ migrations: ['Base1600000000000', target] });
    const result = await new DatabaseHealthCheck(database, target, 'orders').executeAsync();

    expect(result.status).toBe(HealthCheckStatus.ok);
    expect(result.type).toBe('Database');
    expect(result.data.CanConnect).toBe(true);
    expect(result.data.MigrationMatch).toBe(true);
    expect(result.data.MigrationContains).toBe(true);
    expect(result.data.MigrationError).toBeUndefined();
  });

  it('returns failed when connected but the target has not been applied yet', async () => {
    const database = new FakeDatabase({ migrations: ['Base1600000000000'] });
    const result = await new DatabaseHealthCheck(database, target, 'orders').executeAsync();

    expect(result.status).toBe(HealthCheckStatus.failed);
    expect(result.data.MigrationMatch).toBe(false);
    expect(result.data.MigrationContains).toBe(false);
  });

  it('returns failed when the target is applied but is not the LAST migration', async () => {
    const database = new FakeDatabase({ migrations: [target, 'Later1800000000000'] });
    const result = await new DatabaseHealthCheck(database, target, 'orders').executeAsync();

    expect(result.status).toBe(HealthCheckStatus.failed);
    expect(result.data.MigrationMatch).toBe(false);
    expect(result.data.MigrationContains).toBe(true);
  });

  it('returns failed with MigrationError when the migration query throws', async () => {
    const database = new FakeDatabase({ migrations: new Error('no migrations table') });
    const result = await new DatabaseHealthCheck(database, target, 'orders').executeAsync();

    expect(result.status).toBe(HealthCheckStatus.failed);
    expect(result.data.CanConnect).toBe(true);
    expect(result.data.AppliedMigrations).toEqual([]);
    expect(result.data.MigrationMatch).toBe(false);
    expect(result.data.MigrationError).toBeDefined();
  });

  it('returns failed with Error when the connection throws', async () => {
    const database = new FakeDatabase({ connect: new Error('boom'), migrations: [target] });
    const result = await new DatabaseHealthCheck(database, target, 'orders').executeAsync();

    expect(result.status).toBe(HealthCheckStatus.failed);
    expect(result.data.CanConnect).toBe(false);
    expect(result.data.Error).toBeDefined();
  });

  it('has type Database', () => {
    expect(new DatabaseHealthCheck(new FakeDatabase(), target, 'orders').type).toBe('Database');
  });
});
