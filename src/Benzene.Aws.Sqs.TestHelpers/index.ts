/**
 * Test helpers for the standalone SQS polling consumer (`@benzenejs/aws-sqs`): `asSqsMessage(...)` turns a
 * platform-neutral `@benzenejs/testing` `messageBuilder(...)` into the native `@aws-sdk/client-sqs`
 * `Message` the consumer routes on, so a pipeline test builds its input once instead of hand-rolling the
 * message-attribute shape.
 *
 * Port of Benzene.Aws.Sqs.TestHelpers. Unlike the Azure Service Bus / Event Hub test-helper packages,
 * the C# original ships only this message builder (no `*BenzeneTestHost` / `Build*Host`), so the port
 * mirrors that: drive a built `Message` (wrapped in a `{ Messages: [...] }` receive batch) through a
 * `SqsConsumerApplication` directly, exactly as the C# `SqsConsumerMessagePipelineTest` does.
 */
export * from './MessageBuilderExtensions';
