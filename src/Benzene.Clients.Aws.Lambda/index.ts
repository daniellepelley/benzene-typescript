/**
 * Port of Benzene.Clients.Aws.Lambda - the low-level AWS Lambda invoke client. `AwsLambdaClient` (an
 * `IAwsLambdaClient`) invokes a function synchronously (`RequestResponse`) or fire-and-forget (`Event`) via
 * `@aws-sdk/client-lambda`, serializing the request and deserializing the response payload as JSON, and
 * surfacing a `FunctionError` as an `AwsLambdaFunctionErrorException`. `BenzeneMessageClientRequest` is the
 * standard Benzene message envelope; `LocalAwsLambdaClientFactory` builds a profile-authenticated client for
 * local dev.
 *
 * Deferred (documented in the README): the high-level `AwsLambdaBenzeneMessageClient` (its
 * `typeof(TResponse) == typeof(Void)` fire-and-forget branch has no runtime equivalent under TS generic
 * erasure), the outbound middleware-pipeline converter (`UseAwsLambda`), and the `AwsLambdaHealthCheck`
 * (needs the not-yet-ported `HealthCheckMode`/`HealthCheckError`/persistent-failure health-check infra).
 */
export * from './BenzeneMessageClientRequest';
export * from './IAwsLambdaClient';
export * from './AwsLambdaFunctionErrorException';
export * from './AwsLambdaClient';
export * from './LocalAwsLambdaClientFactory';
