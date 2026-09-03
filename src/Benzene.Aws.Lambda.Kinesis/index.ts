/** Port of Benzene.Aws.Lambda.Kinesis (barrel). */
export * from './KinesisMessageContext';
export * from './KinesisMessageBodyGetter';
export * from './KinesisMessageTopicGetter';
export * from './KinesisMessageHeadersGetter';
export * from './KinesisMessageMessageHandlerResultSetter';
export * from './KinesisStreamCheckpointer';
export * from './KinesisApplication';
export * from './KinesisLambdaHandler';
export * from './DependencyInjectionExtensions';
export * from './Extensions';

// STREAMING -> PER-RECORD ADAPTATION: the C# Kinesis adapter is a streaming fan-in
// (`KinesisStreamApplication : StreamMiddlewareApplication<KinesisEvent, KinesisEventRecord>` over
// `StreamContext` / `UseStream`). That engine is not yet ported to this repo (README roadmap: streaming
// is a later phase), so this package routes each record to a `@message` handler instead — but the C#
// CHECKPOINT ENGINE IS ported (W3.3): `KinesisApplication` processes each partition key's records
// sequentially in shard order, stops a partition at its first failure, and reports the R17 #273
// contiguous-prefix watermark (the first unconfirmed record's sequence number) as the single
// `batchItemFailures` resume point via `KinesisStreamCheckpointer`. `KinesisEvent` /
// `KinesisEventRecord` / `KinesisRecordData` are NOT ported — `@types/aws-lambda`'s
// `KinesisStreamEvent` / `KinesisStreamRecord` / `KinesisStreamBatchResponse` are used instead.
// `KinesisStreamOptions` is NOT ported: both its knobs (`AutoCheckpointOnSuccess`,
// `CatchExceptions`) configure handler-owned checkpointing, which doesn't exist in the per-record
// model — see `KinesisApplication`'s doc comment. See KinesisMessageContext for the full rationale.
//
// DEFERRED: KinesisRegistrations.cs (registration diagnostics via RegistrationsBase / RegistrationCheck)
// — the same registration-diagnostics surface deferred for the AWS SqsRegistrations.
