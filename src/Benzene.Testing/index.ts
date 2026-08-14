/**
 * Port of Benzene.Testing - the platform-neutral test-request builders for driving Benzene pipelines in
 * tests without deploying to a cloud host. `messageBuilder(topic, body)` / `httpBuilder(method, path,
 * body)` build a topic/HTTP request with typed body + fluent headers; `asBenzeneMessage` turns a message
 * builder into a `BenzeneMessageRequest`, and `asRawHttpRequest` renders an HTTP builder as raw HTTP/1.1.
 *
 * Transport-specific `as*` builders (turning a builder into a native SQS/SNS/API Gateway/… event) live
 * in the per-platform testing packages, e.g. `@benzenejs/aws-lambda-testing`, which build on these.
 *
 * `benzeneTestHost(StartUp)` is the neutral startup-host builder (port of `BenzeneTestHost` /
 * `BenzeneTestHostBuilder`): boot a real app from its `BenzeneStartUp`, override any dependency with
 * `.withServices(...)` (last-registration-wins), layer config with `.withConfiguration(...)`, then finish
 * with a single transport-specific `build*Host` specialization from a `*.TestHelpers` package
 * (`buildAwsLambdaHost` / `buildAzureFunctionApp`, …). `FakeBenzeneMessageSender` is the first-party egress
 * test double.
 */
export * from './MessageBuilder';
export * from './HttpBuilder';
export * from './MessageBuilderExtensions';
export * from './BenzeneConfiguration';
export * from './BenzeneTestHost';
export * from './FakeBenzeneMessageSender';
export * from './FakeResolver';
export * from './TestPipeline';
