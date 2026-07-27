/**
 * Port of Benzene.Aws.Sqs — the standalone (non-Lambda) SQS polling consumer host.
 *
 * `useSqs(workerStartup, config, clientFactory, action)` adds a long-running {@link SqsConsumer} worker
 * that polls an SQS queue with long polling and runs each received message through a Benzene middleware
 * pipeline, tagging the transport as `"sqs"`. Intended for `@benzene/self-host` workers rather than
 * Lambda (for Lambda-delivered SQS, use `@benzene/aws-lambda-sqs`).
 *
 * ADAPTATION — the SQS client. .NET's `SqsConsumer` calls `IAmazonSQS.ReceiveMessageAsync` /
 * `DeleteMessageBatchAsync` directly; the aws-sdk v3 client uses `client.send(new XCommand(...))`, so
 * the port defines an {@link ISqsConsumerClient} seam (the two operations the consumer needs) wrapped by
 * {@link SqsClientFactory} over a v3 `SQSClient`, and `CancellationToken` maps to `AbortSignal`.
 */
export * from './Consumer/BenzeneInvocationExtensions';
export * from './Consumer/ISqsClientFactory';
export * from './Consumer/ISqsConsumerClient';
export * from './Consumer/SqsClientFactory';
export * from './Consumer/SqsConsumer';
export * from './Consumer/SqsConsumerAckMode';
export * from './Consumer/SqsConsumerApplication';
export * from './Consumer/SqsConsumerBatchResult';
export * from './Consumer/SqsConsumerConfig';
export * from './Consumer/SqsConsumerMessageBodyGetter';
export * from './Consumer/SqsConsumerMessageContext';
export * from './Consumer/SqsConsumerMessageHandlerResultSetter';
export * from './Consumer/SqsConsumerMessageHeadersGetter';
export * from './Consumer/SqsConsumerMessageTopicGetter';
export * from './Consumer/SqsConsumerOptions';
export * from './DependencyInjectionExtensions';
export * from './Extensions';
