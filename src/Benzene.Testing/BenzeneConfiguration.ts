/**
 * A minimal, platform-neutral configuration lookup the test host threads through a
 * {@link BenzeneStartUp}'s `configureServices`/`configure`. Port of the role .NET's `IConfiguration`
 * plays for `BenzeneStartUp`.
 *
 * FIDELITY NOTE: the .NET reference uses `Microsoft.Extensions.Configuration.IConfiguration` (a rich,
 * hierarchical provider stack). Node has no such platform configuration abstraction, so — matching how
 * `@benzene/dependencies` ships a first-party container in place of MEL — this port ships a small
 * key/value lookup. It is only what the test host needs: a startup's own `getConfiguration()` result,
 * with `withConfiguration(...)` overrides layered on top (last-wins).
 */
export interface BenzeneConfiguration {
  /** Returns the configured value for `key`, or `undefined` when it is not set. */
  get(key: string): string | undefined;
}

/** An empty {@link BenzeneConfiguration} — the default when a startup declares no `getConfiguration`. */
export function emptyConfiguration(): BenzeneConfiguration {
  return configurationFrom({});
}

/** Builds a {@link BenzeneConfiguration} over a plain record of values. */
export function configurationFrom(values: Record<string, string | undefined>): BenzeneConfiguration {
  const snapshot = { ...values };
  return {
    get: (key) => snapshot[key],
  };
}

/**
 * Layers `overrides` on top of `base` (last-wins per key), the equivalent of .NET's
 * `ConfigurationBuilder.AddConfiguration(startUp.GetConfiguration()).AddInMemoryCollection(overrides)`.
 */
export function layerConfiguration(
  base: BenzeneConfiguration,
  overrides: Record<string, string>,
): BenzeneConfiguration {
  return {
    get: (key) => (key in overrides ? overrides[key] : base.get(key)),
  };
}
