/**
 * AWS Lambda mesh example — the TypeScript equivalent of .NET's `examples/AwsMesh`: six Benzene Cloud
 * Service Lambdas that self-describe and are directly invocable, plus a mesh that discovers them by tag,
 * interrogates each over a synchronous Lambda invoke, and aggregates the estate into a catalog.
 *
 * `AwsLambdaMeshExampleTest` drives the whole discover → interrogate → aggregate → catalog chain in-memory.
 */
export * from './meshService';
export * from './healthChecks';
export * from './bus';
export * from './services';
export * from './localAwsEnvironment';
export * from './mesh';
