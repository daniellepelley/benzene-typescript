/** Port of Benzene.Azure.Function.Kafka (barrel). */
export * from './KafkaRecord';
export * from './KafkaContext';
export * from './KafkaMessageBodyGetter';
export * from './KafkaMessageTopicGetter';
export * from './KafkaMessageHeadersGetter';
export * from './KafkaMessageMessageHandlerResultSetter';
export * from './KafkaApplication';
export * from './KafkaOptions';
export * from './KafkaMessageProcessingException';
export * from './DependencyInjectionExtensions';
export * from './Extensions';

// TYPE-MODEL ADAPTATION: the .NET `Microsoft.Azure.Functions.Worker` `KafkaRecord` is modelled locally
// (`KafkaRecord.ts`) — `@azure/functions` v4 exposes no first-class Azure-Functions Kafka record type,
// so per the "adapt the integration to the ecosystem" convention the minimal shape the getters read
// (`topic`, `value`) is defined here.
//
// DEFERRED: KafkaRegistrations.cs (registration diagnostics via RegistrationsBase / RegistrationCheck) —
// the same registration-diagnostics surface deferred for the AWS SqsRegistrations and the ported
// ServiceBusRegistrations.
