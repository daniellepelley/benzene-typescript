/**
 * Port of Benzene.Mesh.Discovery.Aws - self-discovery of Benzene services from AWS Lambda functions.
 * `AwsLambdaDiscoveryProvider` enumerates functions (`ListFunctions`) + their tags (`ListTags`), keeps the
 * `benzene`-tagged ones, and emits `AwsLambdaInvoke`-sourced registry entries. Wired via
 * `addMeshAwsLambdaDiscovery`. Adapts `AWSSDK.Lambda` to `@aws-sdk/client-lambda`.
 */
export * from './AwsLambdaDiscoveryProvider';
export * from './Extensions';
