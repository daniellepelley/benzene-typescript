/**
 * The configuration a startup gets when it declares no `getConfiguration`.
 *
 * It used to be an EMPTY lookup, which meant a startup that wanted an environment variable — which
 * is to say almost every startup, since that is what a container, a Lambda, a Function and a Cloud
 * Run revision all inject — had to reach for `process.env` itself. A value read that way goes around
 * `BenzeneTestHost.withConfiguration(...)`, so a component test could not override the thing the
 * service actually reads. The default is now the environment, matching what .NET's `BenzeneStartUp`
 * supplies for the same startup.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  BenzeneConfiguration,
  emptyConfiguration,
  environmentConfiguration,
  layerConfiguration,
} from '@benzenejs/abstractions-middleware';

const KEY = 'BENZENE_TEST_CONFIGURATION_DEFAULT';

describe('the startup configuration default', () => {
  afterEach(() => {
    delete process.env[KEY];
  });

  it('reads environment variables', () => {
    process.env[KEY] = 'from the environment';

    expect(environmentConfiguration().get(KEY)).toBe('from the environment');
  });

  it('reports an unset key as undefined rather than an empty string', () => {
    expect(environmentConfiguration().get(KEY)).toBeUndefined();
  });

  it('snapshots at the moment it is called, exactly as .NET ConfigurationBuilder.Build does', () => {
    // A host reads its configuration once per boot. Pinning the snapshot means a value cannot
    // change under a running service, and means the documented way to steer a test is
    // withConfiguration(...) rather than mutating the environment mid-run.
    process.env[KEY] = 'first';
    const configuration = environmentConfiguration();
    process.env[KEY] = 'second';

    expect(configuration.get(KEY)).toBe('first');
  });

  it('is layerable, so withConfiguration(...) still wins over the environment', () => {
    // The whole point: a component test can now override a value the service genuinely reads.
    process.env[KEY] = 'from the environment';
    const layered: BenzeneConfiguration = layerConfiguration(environmentConfiguration(), {
      [KEY]: 'from the test',
    });

    expect(layered.get(KEY)).toBe('from the test');
  });

  it('emptyConfiguration is still available for a host that must read nothing', () => {
    process.env[KEY] = 'from the environment';

    expect(emptyConfiguration().get(KEY)).toBeUndefined();
  });
});
