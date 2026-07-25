/**
 * Test-event builders for the AWS Lambda transports: turn a platform-neutral `@benzene/testing`
 * `messageBuilder`/`httpBuilder` into the native cloud event the corresponding Benzene adapter routes on
 * (`asApiGatewayRequest`, `asSqs`, `asSns`, `asEventBridge`, `asAwsKafkaEvent`), so a transport pipeline
 * test builds its input once, ergonomically, instead of hand-rolling each event shape.
 *
 * Consolidation divergence from .NET: the C# original ships one `*.TestHelpers` project per transport
 * (each isolating a specific `Amazon.Lambda.*Events` NuGet). In the Node ecosystem every Lambda event
 * type comes from the single `@types/aws-lambda` package, so there is no dependency to isolate - the
 * TypeScript-idiomatic shape is one `@benzene/aws-lambda-testing` package with a builder per transport.
 */
export * from './ApiGatewayMessageBuilderExtensions';
export * from './SqsMessageBuilderExtensions';
export * from './SnsMessageBuilderExtensions';
export * from './EventBridgeMessageBuilderExtensions';
export * from './KafkaMessageBuilderExtensions';
export * from './DynamoDbMessageBuilderExtensions';
export * from './KinesisMessageBuilderExtensions';
export * from './S3MessageBuilderExtensions';
