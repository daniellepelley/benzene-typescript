/**
 * `@benzene-example/versioning` — one BenzeneMessage service dogfooding BOTH of Benzene's versioning axes:
 * handler-version dispatch (`order:create`) and transparent payload casting with caster chaining
 * (`inventory:adjust`). The version always travels as the `benzene-version` metadata header, never in the
 * body. Ported from the .NET `Benzene.Examples.Versioning`. See `README.md`.
 */
export * from './topics';
export * from './contracts/order';
export * from './contracts/inventory';
export * from './services/processedLog';
export * from './handlers';
export * from './startUp';
