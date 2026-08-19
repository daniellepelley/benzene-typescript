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

/**
 * An empty {@link BenzeneConfiguration} — no keys at all. Use it for a host that genuinely must not
 * read its environment; it is no longer what a startup gets by default.
 */
export function emptyConfiguration(): BenzeneConfiguration {
  return configurationFrom({});
}

/**
 * A {@link BenzeneConfiguration} over `process.env` — **the default a host uses when a startup
 * declares no `getConfiguration`**, and the port of .NET's
 * `new ConfigurationBuilder().AddEnvironmentVariables().Build()`.
 *
 * This used to be {@link emptyConfiguration}, and the difference is not cosmetic. Environment
 * variables are what a container, a Lambda, a Function and a Cloud Run revision all actually inject,
 * so a startup that wanted one had to reach for `process.env` itself — and a value read that way
 * goes around `BenzeneTestHost.withConfiguration(...)` entirely, so a component test could not
 * override the thing the service actually reads. Handing the environment in through the same
 * `BenzeneConfiguration` every other value arrives on closes that hole and matches what the .NET
 * reference does for the same startup.
 *
 * Values are snapshotted when this is called, exactly as .NET's `ConfigurationBuilder.Build()`
 * snapshots at build time: a host reads its configuration once per boot, and a `process.env` mutated
 * afterwards is not seen. Override configuration in a test with `withConfiguration(...)`, which
 * layers on top, rather than by mutating the environment.
 */
export function environmentConfiguration(): BenzeneConfiguration {
  return configurationFrom({ ...process.env } as Record<string, string | undefined>);
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
