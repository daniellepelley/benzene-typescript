/** Port of Benzene.Aws.Lambda.Kafka (barrel). */
export * from './KafkaContext';
export * from './KafkaMessageBodyGetter';
export * from './KafkaMessageTopicGetter';
export * from './KafkaMessageHeadersGetter';
export * from './KafkaMessageMessageHandlerResultSetter';
export * from './KafkaApplication';
export * from './KafkaLambdaHandler';
export * from './DependencyInjectionExtensions';
export * from './Extensions';

// TYPE-MODEL ADAPTATION: the .NET `Amazon.Lambda.KafkaEvents` `KafkaEvent` / `KafkaEvent.KafkaEventRecord`
// are NOT modeled here — the ecosystem-native `@types/aws-lambda` `MSKEvent` / `MSKRecord` are used instead
// (the same choice the SQS/SNS adapters made). STRUCTURAL note: `event.records` is an OBJECT keyed by
// `"topic-partition"` → `MSKRecord[]` (flattened by `KafkaApplication`); `record.value` is BASE64 (decoded
// by the body getter); `record.headers` is an array of `{ [key]: number[] }` byte-array batches.
//
// DEFERRED: KafkaRegistrations.cs (registration diagnostics via RegistrationsBase / RegistrationCheck) —
// the same registration-diagnostics surface deferred for the AWS SqsRegistrations/SnsRegistrations.
