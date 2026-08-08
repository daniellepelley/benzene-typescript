/**
 * Umbrella package for building an AWS Lambda service on Benzene — the TypeScript port of the C#
 * `Benzene.Aws.Lambda` project, a references-only meta-package (no source of its own) that pulls in
 * the AWS Lambda packages so a consumer can add one dependency instead of a handful.
 *
 * Re-exports:
 *  - the AWS Lambda **core** (`toLambdaHandler`, `InlineAwsLambdaStartUp`, the composite entry point,
 *    the `isApiGatewayEvent` / `isSqsEvent` … event predicates);
 *  - every AWS Lambda **event-source transport**: API Gateway (`useApiGateway`), SQS (`useSqs`),
 *    SNS (`useSns`), DynamoDB, Kinesis, S3, EventBridge, and Kafka;
 *  - the common **message-handler building blocks** a service's own code imports directly:
 *    `@benzene/core-message-handlers` (`addBenzene`, `useMessageHandlers`, `message`, …),
 *    `@benzene/results` (`BenzeneResult`), and the `@benzene/abstractions*` result / handler interfaces.
 *
 * So a service can `npm install @benzene/aws-lambda` and import everything it needs from here, or
 * depend on the individual `@benzene/aws-lambda-*` / `@benzene/core-*` packages for a narrower surface.
 *
 * PORTING NOTE: the building-block re-exports (last group) are a TypeScript-idiom bend, not present in
 * the C# `Benzene.Aws.Lambda` meta-package — in .NET those types come through automatically as
 * transitive references, whereas an npm consumer only sees what an entry point re-exports, so the
 * umbrella surfaces them explicitly to give the same one-import experience. As with `@benzene/clients-aws`,
 * identically-named internal helpers that appear in more than one underlying package are ambiguous
 * across a wildcard re-export and are therefore not surfaced here; import them from the specific
 * package if you need them. The public entry points (`use*` / `toLambdaHandler` / `message` /
 * `BenzeneResult` and their types) are unique and come through.
 */
export * from '@benzene/aws-lambda-core';
export * from '@benzene/aws-lambda-api-gateway';
export * from '@benzene/aws-lambda-sqs';
export * from '@benzene/aws-lambda-sns';
export * from '@benzene/aws-lambda-dynamodb';
export * from '@benzene/aws-lambda-kinesis';
export * from '@benzene/aws-lambda-s3';
export * from '@benzene/aws-lambda-eventbridge';
export * from '@benzene/aws-lambda-kafka';
export * from '@benzene/core-message-handlers';
export * from '@benzene/results';
export * from '@benzene/abstractions';
export * from '@benzene/abstractions-message-handlers';

// Disambiguation: two grouping-constant objects are exported by more than one package above, which is
// ambiguous across the wildcard re-exports. Surface the framework-level one under the bare name; the
// transport-specific `Constants` (from `@benzene/aws-lambda-api-gateway`) is not surfaced here — import
// it from that package directly if you need it.
export { Constants } from '@benzene/core-message-handlers';
export { TransportNames } from '@benzene/abstractions-message-handlers';
