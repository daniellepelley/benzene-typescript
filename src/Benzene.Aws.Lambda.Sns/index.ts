/** Port of Benzene.Aws.Lambda.Sns (barrel). */
export * from './SnsRecordContext';
export * from './SnsUtils';
export * from './SnsMessageBodyGetter';
export * from './SnsMessageTopicGetter';
export * from './SnsMessageHeadersGetter';
export * from './SnsMessageMessageHandlerResultSetter';
export * from './SnsApplication';
export * from './SnsLambdaHandler';
export * from './SnsOptions';
export * from './SnsMessageProcessingException';
export * from './DependencyInjectionExtensions';
export * from './Extensions';

// DEFERRED: SnsRegistrations.cs (registration diagnostics via RegistrationsBase / RegistrationCheck) —
// the same registration-diagnostics surface deferred for the AWS SqsRegistrations.
