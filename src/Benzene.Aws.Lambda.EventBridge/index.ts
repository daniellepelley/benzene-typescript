/** Port of Benzene.Aws.Lambda.EventBridge (barrel). */
export * from './EventBridgeContext';
export * from './EventBridgeMessageBodyGetter';
export * from './EventBridgeMessageTopicGetter';
export * from './EventBridgeMessageHeadersGetter';
export * from './EventBridgeMessageMessageHandlerResultSetter';
export * from './EventBridgeApplication';
export * from './EventBridgeLambdaHandler';
export * from './DependencyInjectionExtensions';
export * from './Extensions';

// TYPE-MODEL ADAPTATION: EventBridgeEvent.cs is NOT ported — the .NET package models its own envelope only
// to avoid an extra AWS dependency, whereas this port already depends on `@types/aws-lambda` and uses its
// `EventBridgeEvent<TDetailType, TDetail>` (the same choice every other AWS adapter here makes). Its
// `detail` is a parsed value (`unknown`) rather than a raw `JsonElement`, and `detail-type` is a hyphenated
// key. STRUCTURAL NOTE: EventBridge delivers a SINGLE event per invocation (not a `Records` batch), so the
// application is a single-context `MiddlewareApplication` and the handler discriminates on `detail-type` +
// `source` rather than on a records array.
//
// DEFERRED: EventBridgeRegistrations.cs (registration diagnostics via RegistrationsBase / RegistrationCheck)
// — the same registration-diagnostics surface deferred for the AWS SqsRegistrations/SnsRegistrations.
