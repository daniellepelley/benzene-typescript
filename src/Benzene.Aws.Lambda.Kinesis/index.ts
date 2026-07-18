/** Port of Benzene.Aws.Lambda.Kinesis (barrel). */
export * from './KinesisMessageContext';
export * from './KinesisMessageBodyGetter';
export * from './KinesisMessageTopicGetter';
export * from './KinesisMessageHeadersGetter';
export * from './KinesisMessageMessageHandlerResultSetter';
export * from './KinesisApplication';
export * from './KinesisLambdaHandler';
export * from './DependencyInjectionExtensions';
export * from './Extensions';

// STREAMING -> PER-RECORD FAN-OUT ADAPTATION: the C# Kinesis adapter is a streaming fan-in
// (`KinesisStreamApplication : StreamMiddlewareApplication<KinesisEvent, KinesisEventRecord>` over
// `StreamContext` / `UseStream`). That engine is not yet ported to this repo (README roadmap: streaming
// is a later phase), so this package adapts Kinesis to the SQS/SNS per-record fan-out shape. `KinesisEvent`
// / `KinesisEventRecord` / `KinesisRecordData` are NOT ported — `@types/aws-lambda`'s `KinesisStreamEvent`
// / `KinesisStreamRecord` are used instead. See KinesisMessageContext for the full rationale.
//
// DEFERRED: KinesisRegistrations.cs (registration diagnostics via RegistrationsBase / RegistrationCheck)
// — the same registration-diagnostics surface deferred for the AWS SqsRegistrations.
