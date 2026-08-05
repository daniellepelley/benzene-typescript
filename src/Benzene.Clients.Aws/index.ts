/**
 * Umbrella package for the AWS outbound clients — the TypeScript port of the C# `Benzene.Clients.Aws`
 * project, which is itself a references-only meta-package (no source of its own) that pulls in the
 * individual AWS client packages so a consumer can add one dependency instead of five.
 *
 * Re-exports the outbound-client surface of each underlying package: the broker route extensions and their
 * companions for SNS (`useSns` / `useSnsClient` / `addSnsHealthCheck`), SQS (`useSqs` / `useSqsClient` /
 * `addSqsHealthCheck`), and EventBridge (`useEventBridge` / `useEventBridgeClient` /
 * `addEventBridgeHealthCheck`); the Step Functions client (`StepFunctionsClient` /
 * `StepFunctionsClientFactory` / `StepFunctionsHealthCheck`); and the low-level AWS Lambda invoke client
 * (`AwsLambdaClient` / `LocalAwsLambdaClientFactory`). Depend on this package for the whole AWS
 * outbound-client surface, or on the individual `@benzene/clients-aws-*` packages for a narrower dependency.
 *
 * PORTING NOTE: identically-named internal helpers that appear in more than one of the underlying
 * packages (e.g. each package's own `awsErrorDetails`) are ambiguous across a wildcard re-export and are
 * therefore not surfaced from this umbrella; import them from the specific package if you need them. The
 * public entry points (`use*` / `add*` and their types) are unique per transport and come through.
 */
export * from '@benzene/clients-aws-sqs';
export * from '@benzene/clients-aws-sns';
export * from '@benzene/clients-aws-eventbridge';
export * from '@benzene/clients-aws-lambda';
export * from '@benzene/clients-aws-step-functions';
