import { describe, expect, it } from 'vitest';
import {
  InMemorySecretStore,
  MissingSecretException,
  SecretResolver,
  SecretValidation,
} from '@benzene/configuration-core';

/**
 * Port of test/Benzene.Core.Test/Configuration/SecretResolverAndValidationTest.cs. SecretResolver
 * (typed, fail-fast reads) and SecretValidation (startup completeness check).
 */

function resolver(...values: [name: string, value: string][]): SecretResolver {
  return new SecretResolver(new InMemorySecretStore(new Map(values)));
}

describe('SecretResolver and SecretValidation', () => {
  it('require returns the value when present', async () => {
    expect(await resolver(['Api:Key', 'v']).requireAsync('Api:Key')).toBe('v');
  });

  it('require throws when missing, listing the name', async () => {
    await expect(resolver().requireAsync('Api:Key')).rejects.toSatisfy(
      (error) => error instanceof MissingSecretException && error.missingNames.includes('Api:Key'),
    );
  });

  it('require throws when blank', async () => {
    await expect(resolver(['Api:Key', '   ']).requireAsync('Api:Key')).rejects.toThrow(
      MissingSecretException,
    );
  });

  it('get returns the default when missing', async () => {
    expect(await resolver().getAsync('Api:Key', 'fallback')).toBe('fallback');
    expect(await resolver(['Api:Key', 'real']).getAsync('Api:Key', 'fallback')).toBe('real');
  });

  it('typed reads parse or throw', async () => {
    const r = resolver(
      ['Port', '8080'],
      ['Enabled', 'true'],
      ['Endpoint', 'https://api.example.com'],
      ['BadPort', 'notanumber'],
    );

    expect(await r.requireIntAsync('Port')).toBe(8080);
    expect(await r.requireBoolAsync('Enabled')).toBe(true);
    expect((await r.requireUriAsync('Endpoint')).href).toBe('https://api.example.com/');

    await expect(r.requireIntAsync('BadPort')).rejects.toThrow(/not a valid integer/);
  });

  it('ensureRequired passes when all present', async () => {
    const store = new InMemorySecretStore({ 'Db:Password': 'p', 'Api:Key': 'k' });

    await expect(
      SecretValidation.ensureRequiredAsync(store, 'Db:Password', 'Api:Key'),
    ).resolves.toBeUndefined();
  });

  it('ensureRequired throws listing all missing at once', async () => {
    const store = new InMemorySecretStore({ Present: 'v' });

    await expect(
      SecretValidation.ensureRequiredAsync(store, 'Present', 'Missing1', 'Missing2'),
    ).rejects.toSatisfy(
      (error) =>
        error instanceof MissingSecretException &&
        error.missingNames.includes('Missing1') &&
        error.missingNames.includes('Missing2') &&
        !error.missingNames.includes('Present'),
    );
  });
});
