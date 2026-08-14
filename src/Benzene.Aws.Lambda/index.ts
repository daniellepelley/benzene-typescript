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
 *    `@benzenejs/core-message-handlers` (`addBenzene`, `useMessageHandlers`, `message`, …),
 *    `@benzenejs/results` (`BenzeneResult`), and the `@benzenejs/abstractions*` result / handler interfaces.
 *
 * So a service can `npm install @benzenejs/aws-lambda` and import everything it needs from here, or
 * depend on the individual `@benzenejs/aws-lambda-*` / `@benzenejs/core-*` packages for a narrower surface.
 *
 * PORTING NOTE: the building-block re-exports (last group) are a TypeScript-idiom bend, not present in
 * the C# `Benzene.Aws.Lambda` meta-package — in .NET those types come through automatically as
 * transitive references, whereas an npm consumer only sees what an entry point re-exports, so the
 * umbrella surfaces them explicitly to give the same one-import experience. As with `@benzenejs/clients-aws`,
 * identically-named internal helpers that appear in more than one underlying package are ambiguous
 * across a wildcard re-export and are therefore not surfaced here; import them from the specific
 * package if you need them. The public entry points (`use*` / `toLambdaHandler` / `message` /
 * `BenzeneResult` and their types) are unique and come through.
 */
export * from '@benzenejs/aws-lambda-core';
export * from '@benzenejs/aws-lambda-api-gateway';
export * from '@benzenejs/aws-lambda-sqs';
export * from '@benzenejs/aws-lambda-sns';
export * from '@benzenejs/aws-lambda-dynamodb';
export * from '@benzenejs/aws-lambda-kinesis';
export * from '@benzenejs/aws-lambda-s3';
export * from '@benzenejs/aws-lambda-eventbridge';
export * from '@benzenejs/aws-lambda-kafka';
export * from '@benzenejs/core-message-handlers';
export * from '@benzenejs/results';
export * from '@benzenejs/abstractions';
export * from '@benzenejs/abstractions-message-handlers';

// Disambiguation: two grouping-constant objects are exported by more than one package above, which is
// ambiguous across the wildcard re-exports. Surface the framework-level one under the bare name; the
// transport-specific `Constants` (from `@benzenejs/aws-lambda-api-gateway`) is not surfaced here — import
// it from that package directly if you need it.
export { Constants } from '@benzenejs/core-message-handlers';
export { TransportNames } from '@benzenejs/abstractions-message-handlers';
