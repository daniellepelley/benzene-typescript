import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CachingSecretStore,
  CompositeSecretStore,
  EnvironmentVariableSecretStore,
  FileSecretStore,
  InMemorySecretStore,
  ISecretStore,
} from '@benzene/configuration-core';

/**
 * Port of test/Benzene.Core.Test/Configuration/SecretStoresTest.cs. The store implementations
 * (in-memory, env vars, files, composite, caching) - all runtime-only and exercisable without any
 * cloud dependency.
 */
describe('secret stores', () => {
  it('in-memory returns a value, or undefined when absent', async () => {
    const store = new InMemorySecretStore({ 'Db:Password': 's3cret' });

    expect(await store.getSecretAsync('Db:Password')).toBe('s3cret');
    expect(await store.getSecretAsync('Missing')).toBeUndefined();
  });

  it.each([
    ['Db:Password', 'DB_PASSWORD'],
    ['Api.Key', 'API_KEY'],
    ['feature-flag', 'FEATURE_FLAG'],
  ])('environment variable maps logical name %s to key %s', (name, expectedKey) => {
    expect(EnvironmentVariableSecretStore.toEnvironmentVariableKey(name)).toBe(expectedKey);
  });

  describe('environment variable store', () => {
    beforeEach(() => {
      process.env.BENZENE_TEST_DB_PASSWORD = 'from-env';
    });
    afterEach(() => {
      delete process.env.BENZENE_TEST_DB_PASSWORD;
    });

    it('reads the mapped variable', async () => {
      const store = new EnvironmentVariableSecretStore('Benzene_Test_');

      expect(await store.getSecretAsync('Db:Password')).toBe('from-env');
      expect(await store.getSecretAsync('Nope')).toBeUndefined();
    });
  });

  describe('file store', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'benzene-secrets-'));
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('reads content, trims a trailing newline, and is undefined when absent', async () => {
      await writeFile(join(dir, 'db_password'), 'file-secret\n');
      const store = new FileSecretStore(dir);

      expect(await store.getSecretAsync('db_password')).toBe('file-secret');
      expect(await store.getSecretAsync('absent')).toBeUndefined();
    });
  });

  it('composite returns the first non-undefined value', async () => {
    const store = new CompositeSecretStore(
      new InMemorySecretStore({ Shared: 'from-first' }),
      new InMemorySecretStore({ Shared: 'from-second', Only2: 'v2' }),
    );

    expect(await store.getSecretAsync('Shared')).toBe('from-first'); // earliest store wins
    expect(await store.getSecretAsync('Only2')).toBe('v2'); // falls through
    expect(await store.getSecretAsync('Nowhere')).toBeUndefined();
  });

  it('caching serves from cache within TTL, refetches after expiry, and on invalidate', async () => {
    let now = 1_000_000;
    let calls = 0;
    const inner: ISecretStore = {
      getSecretAsync: () => {
        calls++;
        return Promise.resolve('v');
      },
    };
    const cache = new CachingSecretStore(inner, 5 * 60 * 1000, () => now);

    expect(await cache.getSecretAsync('k')).toBe('v');
    expect(await cache.getSecretAsync('k')).toBe('v');
    expect(calls).toBe(1); // second read served from cache

    now += 6 * 60 * 1000; // TTL lapses
    expect(await cache.getSecretAsync('k')).toBe('v');
    expect(calls).toBe(2); // re-fetched

    cache.invalidate('k'); // explicit reload
    expect(await cache.getSecretAsync('k')).toBe('v');
    expect(calls).toBe(3);
  });
});
