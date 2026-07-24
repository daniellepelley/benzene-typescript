import { describe, expect, it } from 'vitest';
import {
  InMemorySchemaRegistryClient,
  SchemaCompatibilityMode,
  SchemaDefinition,
  SchemaFormat,
  SchemaIncompatibleException,
} from '@benzene/schema-registry-core';

/** Port of test/Benzene.Core.Test/SchemaRegistry/InMemorySchemaRegistryClientTest.cs. */

const schema = (subject: string, body: string): SchemaDefinition =>
  new SchemaDefinition(subject, body, SchemaFormat.Avro);

describe('InMemorySchemaRegistryClient', () => {
  it('Register_AssignsId_AndIsIdempotentForIdenticalSchema', async () => {
    const registry = new InMemorySchemaRegistryClient(SchemaCompatibilityMode.None);

    const id1 = await registry.registerAsync(schema('orders-value', '{"v":1}'));
    const id2 = await registry.registerAsync(schema('orders-value', '{"v":1}')); // identical

    expect(id1).toBe(id2);
  });

  it('Register_DistinctSubjects_GetDistinctIds', async () => {
    const registry = new InMemorySchemaRegistryClient(SchemaCompatibilityMode.None);

    const a = await registry.registerAsync(schema('a-value', '{"v":1}'));
    const b = await registry.registerAsync(schema('b-value', '{"v":1}'));

    expect(a).not.toBe(b);
  });

  it('GetById_ReturnsRegisteredSchema_UndefinedForUnknown', async () => {
    const registry = new InMemorySchemaRegistryClient(SchemaCompatibilityMode.None);
    const id = await registry.registerAsync(schema('orders-value', '{"v":1}'));

    const found = await registry.getByIdAsync(id);
    expect(found).toBeDefined();
    expect(found!.subject).toBe('orders-value');
    expect(found!.version).toBe(1);

    expect(await registry.getByIdAsync(9999)).toBeUndefined();
  });

  it('GetLatest_ReturnsHighestVersion', async () => {
    const registry = new InMemorySchemaRegistryClient(SchemaCompatibilityMode.None);
    await registry.registerAsync(schema('orders-value', '{"v":1}'));
    await registry.registerAsync(schema('orders-value', '{"v":2}'));

    const latest = await registry.getLatestAsync('orders-value');

    expect(latest!.version).toBe(2);
    expect(latest!.schema).toBe('{"v":2}');
  });

  it('Register_IncompatibleUnderBackward_Throws_ButNoneAllows', async () => {
    // Default textual checker: under Backward, a changed schema for an existing subject is rejected;
    // under None it's accepted.
    const strict = new InMemorySchemaRegistryClient(SchemaCompatibilityMode.Backward);
    await strict.registerAsync(schema('orders-value', '{"v":1}'));

    expect(await strict.isCompatibleAsync(schema('orders-value', '{"v":2}'))).toBe(false);
    await expect(strict.registerAsync(schema('orders-value', '{"v":2}'))).rejects.toBeInstanceOf(
      SchemaIncompatibleException,
    );

    const lax = new InMemorySchemaRegistryClient(SchemaCompatibilityMode.None);
    await lax.registerAsync(schema('orders-value', '{"v":1}'));
    await lax.registerAsync(schema('orders-value', '{"v":2}')); // allowed
  });

  it('FirstSchemaForSubject_IsAlwaysCompatible', async () => {
    const registry = new InMemorySchemaRegistryClient(SchemaCompatibilityMode.Full);

    expect(await registry.isCompatibleAsync(schema('new-value', '{"v":1}'))).toBe(true);
  });
});
