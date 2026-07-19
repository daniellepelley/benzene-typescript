/** Port of Benzene.Aws.Lambda.S3 (barrel). */
export * from './S3RecordContext';
export * from './S3Notification';
export * from './S3MessageBodyGetter';
export * from './S3MessageTopicGetter';
export * from './S3MessageHeadersGetter';
export * from './S3MessageMessageHandlerResultSetter';
export * from './S3Application';
export * from './S3LambdaHandler';
export * from './DependencyInjectionExtensions';
export * from './Extensions';

// TYPE-MODEL ADAPTATION: the .NET `Amazon.Lambda.S3Events` `S3Event` / `S3Event.S3EventNotificationRecord`
// are NOT modeled here — the ecosystem-native `@types/aws-lambda` `S3Event` / `S3EventRecord` are used
// instead (the same choice the SQS/SNS adapters made). Record fields are camelCase there
// (`record.eventSource`, `record.s3.bucket.name`, `record.s3.object.key`).
//
// DEFERRED: S3Registrations.cs (registration diagnostics via RegistrationsBase / RegistrationCheck) — the
// same registration-diagnostics surface deferred for the AWS SqsRegistrations/SnsRegistrations.
