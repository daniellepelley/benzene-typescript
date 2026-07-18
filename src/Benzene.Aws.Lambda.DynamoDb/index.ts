/** Port of Benzene.Aws.Lambda.DynamoDb (barrel). */
export * from './DynamoDbRecordContext';
export * from './DynamoDbAttributeValueConverter';
export * from './DynamoDbUtils';
export * from './DynamoDbMessageBodyGetter';
export * from './DynamoDbMessageTopicGetter';
export * from './DynamoDbMessageHeadersGetter';
export * from './DynamoDbMessageMessageHandlerResultSetter';
export * from './DynamoDbApplication';
export * from './DynamoDbLambdaHandler';
export * from './DependencyInjectionExtensions';
export * from './Extensions';

// TYPE-MODEL ADAPTATION: DynamoDbEvent.cs / DynamoDbStreamRecord.cs / DynamoDbStreamData.cs /
// DynamoDbBatchResponse.cs are NOT ported — the ecosystem-native `@types/aws-lambda`
// `DynamoDBStreamEvent` / `DynamoDBRecord` / `StreamRecord` / `DynamoDBBatchResponse` are used instead
// (the same choice the SQS adapter made with `SQSEvent`/`SQSRecord`).
//
// DEFERRED: DynamoDbRegistrations.cs (registration diagnostics via RegistrationsBase / RegistrationCheck)
// — the same registration-diagnostics surface deferred for the AWS SqsRegistrations.
