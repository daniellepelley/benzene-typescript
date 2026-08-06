import { IEntryPointMiddlewareApplication } from '@benzene/abstractions-middleware';
import { MessagePublishedData } from '@benzene/google-cloud-functions-pubsub';

/**
 * In-memory Google Cloud Functions Pub/Sub test host — the GCP Pub/Sub counterpart of
 * `AwsLambdaBenzeneTestHost` (SQS/SNS consumer) and `GoogleCloudFunctionBenzeneTestHost` (the HTTP
 * sibling). Wraps the built entry-point application that a real Pub/Sub CloudEvent invocation dispatches
 * through, and pushes native `MessagePublishedData` payloads (built by `asPubSubEvent` /
 * `PubSubMessageBuilder` in this package) in through the front door via a single `sendPubSubAsync`.
 *
 * Pub/Sub is a fire-and-consume trigger — there is no HTTP response to map, so `sendPubSubAsync` returns
 * `Promise<void>` (matching the transport's `IEntryPointMiddlewareApplication.sendAsync`). Assertions are
 * made on egress — what the handler published through a faked `IBenzeneMessageSender` — exactly as the
 * consumer-worker tests do.
 *
 * IDIOM MAP: the C# `TestGooglePubSubFunction` is an `ICloudEventFunction<MessagePublishedData>` wrapper,
 * and `SendPubSubAsync` is a separate extension on it that mints a minimal, inert `CloudEvent` envelope
 * only because the wrapper's `HandleAsync(cloudEvent, data, ct)` signature demands one (the body ignores
 * it and calls `app.SendAsync(data)`). The TS host holds the built
 * `IEntryPointMiddlewareApplication<MessagePublishedData>` directly — the same object `appBuilder.build(...)`
 * returns for a real deployment — so, exactly as the HTTP sibling folds dispatch into its `sendHttpAsync`,
 * this folds it into `sendPubSubAsync`, calling `app.sendAsync(data)` with no CloudEvent ceremony (there is
 * no `ICloudEventFunction` interface at this seam to satisfy). The name keeps the C#'s `SendPubSubAsync`
 * (Pub/Sub is this host's only trigger), the GCP peer of the AWS/Azure `sendEventAsync`.
 */
export class GooglePubSubFunctionBenzeneTestHost {
  constructor(private readonly app: IEntryPointMiddlewareApplication<MessagePublishedData>) {}

  /**
   * Sends a native `MessagePublishedData` through the pipeline. Pub/Sub delivers exactly one message per
   * invocation with no response, so this resolves once the handler has finished; assert on egress (a faked
   * `IBenzeneMessageSender`) for what the service published.
   * @param data The Pub/Sub payload (typically built by `asPubSubEvent(...)` or `new PubSubMessageBuilder()...build()`).
   */
  sendPubSubAsync(data: MessagePublishedData): Promise<void> {
    return this.app.sendAsync(data);
  }
}
