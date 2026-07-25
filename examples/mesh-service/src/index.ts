/**
 * `@benzene-example/mesh-service` - a runnable, mesh-discoverable TypeScript Benzene HTTP service. Point a
 * mesh aggregator (TypeScript or .NET) at its `/benzene/spec` + `/benzene/health` endpoints to catalog it
 * alongside services written in any other language. See `README.md`.
 */
export * from './handlers';
export * from './benzeneSpec';
export * from './health';
export * from './orderService';
