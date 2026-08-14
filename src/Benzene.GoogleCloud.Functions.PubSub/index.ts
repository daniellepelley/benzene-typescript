/**
 * `@benzenejs/google-cloud-functions-pubsub` — consume Pub/Sub messages on Google Cloud Functions Gen2 via
 * a CloudEvent (push-subscription) trigger. Port of Benzene.GoogleCloud.Functions.PubSub.
 *
 * Pub/Sub delivers exactly one message per invocation, so this is a single-message trigger. Wire it
 * through `useMessageHandlers()` exactly like every other transport, using the "topic in a custom
 * attribute" convention (`"topic"` by default).
 */
export * from './MessagePublishedData';
export * from './PubSubContext';
export * from './PubSubMessageBodyGetter';
export * from './PubSubMessageHeadersGetter';
export * from './PubSubMessageTopicGetter';
export * from './PubSubMessageHandlerResultSetter';
export * from './PubSubMessageProcessingException';
export * from './PubSubOptions';
export * from './PubSubMiddlewareApplication';
export * from './GooglePubSubFunctionApplicationBuilder';
export * from './DependencyInjectionExtensions';
export * from './GooglePubSubFunctionHost';

// DEFERRED:
//   - PubSubRegistrations.cs (registration diagnostics via RegistrationsBase / RegistrationCheck) — the
//     same registration-diagnostics surface deferred for the AWS SqsRegistrations / Azure
//     ServiceBusRegistrations.
//   - Preset-topic override (UsePresetTopic wiring) — not implemented in the .NET package either (see
//     addGooglePubSub's notes).
