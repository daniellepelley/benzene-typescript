/**
 * Port of Benzene.Testing - the platform-neutral test-request builders for driving Benzene pipelines in
 * tests without deploying to a cloud host. `messageBuilder(topic, body)` / `httpBuilder(method, path,
 * body)` build a topic/HTTP request with typed body + fluent headers; `asBenzeneMessage` turns a message
 * builder into a `BenzeneMessageRequest`, and `asRawHttpRequest` renders an HTTP builder as raw HTTP/1.1.
 *
 * Transport-specific `as*` builders (turning a builder into a native SQS/SNS/API Gateway/… event) live
 * in the per-platform testing packages, e.g. `@benzene/aws-lambda-testing`, which build on these.
 *
 * Divergence from .NET: the `BenzeneTestHost`/`BenzeneTestHostBuilder` startup-host builder (which wraps
 * a `BenzeneStartUp` + MEL container) is not ported here - the TypeScript port's transports are driven
 * directly via their `*Application`/`InlineAwsLambdaStartUp` entry points; these builders provide the
 * request-construction half, which is the reused, transport-testing core. See the README.
 */
export * from './MessageBuilder';
export * from './HttpBuilder';
export * from './MessageBuilderExtensions';
