import { PubSub } from '@google-cloud/pubsub';
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { OutboundContext } from '@benzene/clients';
import { OutboundPubSubContextConverter } from './OutboundPubSubContextConverter';
import { PubSubClientMiddleware } from './PubSubClientMiddleware';
import { PubSubSendMessageContext } from './PubSubSendMessageContext';

/**
 * Port of Benzene.Clients.GoogleCloud.PubSub.Extensions (C# fluent extension methods -> free functions
 * taking the builder first) — the Google Cloud counterpart of `@benzene/clients-aws-sqs`'s `useSqs`.
 *
 * PORT DIVERGENCE: like the AWS/Azure client siblings, the client is passed explicitly (there is no
 * synthetic DI token for the raw `@google-cloud/pubsub` `PubSub` client), so the container-resolved
 * `.UsePubSubClient()` / custom-middleware `.UsePubSub(topic, action)` overloads are omitted in favour
 * of the explicit-client form.
 */

/** Appends the terminal `PubSubClientMiddleware` (built from `pubSub`) to a Pub/Sub send pipeline. */
export function usePubSubClient(
  app: IMiddlewarePipelineBuilder<PubSubSendMessageContext>,
  pubSub: PubSub,
): IMiddlewarePipelineBuilder<PubSubSendMessageContext> {
  return app.use(() => new PubSubClientMiddleware(pubSub));
}

/**
 * Converts an outbound route pipeline (`OutboundRoutingBuilder.route`) to publish via Pub/Sub: the routed
 * message becomes the Pub/Sub message data, the routing topic + per-call headers become message
 * attributes, and the message is published to `topic` (a full `projects/.../topics/...` path or a bare
 * topic id resolved against `GOOGLE_CLOUD_PROJECT`).
 */
export function usePubSub(
  app: IMiddlewarePipelineBuilder<OutboundContext>,
  pubSub: PubSub,
  topic: string,
  topicAttributeKey: string = OutboundPubSubContextConverter.DefaultTopicAttribute,
): IMiddlewarePipelineBuilder<OutboundContext> {
  return app.convert(new OutboundPubSubContextConverter(topic, topicAttributeKey), (builder) =>
    usePubSubClient(builder, pubSub),
  );
}
