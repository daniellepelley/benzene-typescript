/**
 * A minimal, platform-neutral configuration lookup a {@link BenzeneStartUp} threads through its
 * `configureServices`/`configure`. Port of the role .NET's `IConfiguration` plays for `BenzeneStartUp`.
 *
 * FIDELITY NOTE: the .NET reference uses `Microsoft.Extensions.Configuration.IConfiguration` (a rich,
 * hierarchical provider stack). Node has no such platform configuration abstraction, so — matching how
 * `@benzenejs/dependencies` ships a first-party container in place of MEL — this port ships a small
 * key/value lookup: a startup's own `getConfiguration()` result, with any `withConfiguration(...)`
 * overrides layered on top (last-wins).
 *
 * LOCATION NOTE: this lived in `@benzenejs/testing` while the only consumer of `BenzeneStartUp` was the
 * test host. Now that a production host (`AwsLambdaHost<TStartUp>`) boots the same `BenzeneStartUp`, it
 * moved here — the neutral hosting-abstractions package both consume — so no production package depends
 * on the testing package. `@benzenejs/testing` re-exports it for backward compatibility.
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
