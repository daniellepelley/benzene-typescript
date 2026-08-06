/**
 * `@benzene/google-cloud-functions-pubsub-testing` — the in-memory test harness for a Benzene service
 * hosted on Google Cloud Functions Gen2 Pub/Sub. Port of Benzene.GoogleCloud.Functions.PubSub.TestHelpers,
 * and the GCP Pub/Sub counterpart of `@benzene/aws-lambda-testing` (SQS/SNS consumer) /
 * `@benzene/google-cloud-functions-http-testing`.
 *
 * Boot a real startup with `benzeneTestHost(MyStartUp)` (from `@benzene/testing`), override any dependency
 * with `.withServices(...)`, then finish with the single GCP-specific line `buildGooglePubSubFunctionHost(...)`
 * to get a {@link GooglePubSubFunctionBenzeneTestHost}. Turn a neutral `messageBuilder(topic, body)` into the
 * native Pub/Sub payload with `asPubSubEvent` (or build one directly with `PubSubMessageBuilder`), push it in
 * with `host.sendPubSubAsync(data)`, and assert on egress — what the handler published through a faked
 * `IBenzeneMessageSender`. Pub/Sub is a fire-and-consume trigger (no response), so `sendPubSubAsync` resolves
 * `void`; there is no live Functions Framework server and no credentials.
 *
 * MESSAGE-TYPE / INERT-CLOUDEVENT DIVERGENCE (same root as the transport's): the C# helpers build the
 * `Google.Events.Protobuf` protobuf `MessagePublishedData`/`PubsubMessage` and dispatch through an
 * `ICloudEventFunction` wrapper (minting an inert `CloudEvent` envelope). The TS port models the
 * already-JSON CloudEvent `MessagePublishedData` (body base64 on `message.data`) and holds the built
 * entry-point application directly, so the builders base64-encode the body and the host dispatches with
 * `app.sendAsync(data)` — no protobuf runtime and no CloudEvent ceremony. See the README "Porting
 * conventions" ledger.
 */
export * from './GooglePubSubFunctionBenzeneTestHost';
export * from './BenzeneTestHostExtensions';
export * from './PubSubMessageBuilderExtensions';
export * from './PubSubMessageBuilder';
