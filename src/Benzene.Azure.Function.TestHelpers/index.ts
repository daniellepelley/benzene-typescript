/**
 * Test-event builders for the Azure Functions triggers: turn a platform-neutral `@benzene/testing`
 * `messageBuilder`/`httpBuilder` into the native trigger payload the corresponding Benzene adapter routes
 * on (`asAzureHttpRequest`, `asAzureServiceBusMessage`, `asEventHubBenzeneMessage`), so a trigger pipeline
 * test builds its input once instead of hand-rolling each payload shape. The Azure counterpart of
 * `@benzene/aws-lambda-testing`.
 *
 * Consolidation divergence from .NET (same as the AWS package): the C# original ships one `*.TestHelpers`
 * project per trigger; in Node the payload types come from a few shared packages (`@azure/functions`,
 * `@azure/service-bus`, `@azure/event-hubs`), so one `@benzene/azure-function-testing` package with a
 * builder per trigger is the idiomatic shape. (Queue Storage is not ported, so it has no builder.)
 *
 * `buildAzureFunctionApp(...)` is the Azure specialization step for `benzeneTestHost(...)` (from
 * `@benzene/testing`) — the Azure counterpart of `buildAwsLambdaHost`: the one transport-specific line that
 * turns a neutral, booted-from-startup test host into an `AzureFunctionBenzeneTestHost` you push native
 * trigger payloads into with `sendEventAsync`.
 */
export * from './AzureFunctionBenzeneTestHost';
export * from './BenzeneTestHostExtensions';
export * from './AzureHttpBuilderExtensions';
export * from './ServiceBusMessageBuilderExtensions';
export * from './EventHubMessageBuilderExtensions';
export * from './KafkaMessageBuilderExtensions';
