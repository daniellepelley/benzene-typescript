/** Port of Benzene.Clients.GoogleCloud.PubSub.PubSubClientMiddleware. */
import { PubSub } from '@google-cloud/pubsub';
import { IMiddleware, NextFunc } from '@benzenejs/abstractions-middleware';
import { PubSubSendMessageContext } from './PubSubSendMessageContext';

/**
 * Terminal middleware that publishes the context's message to Pub/Sub and records the server-assigned
 * message id on the context. A publish failure throws (Pub/Sub has no per-message HTTP status the way
 * SQS does), which the outbound routing pipeline surfaces to the caller. It does not call `next`.
 *
 * PORTING NOTE: .NET's low-level `PublisherServiceApiClient.PublishAsync(topicName, messages)` (returning
 * a `PublishResponse` with `MessageIds`) maps to `@google-cloud/pubsub`'s high-level
 * `pubSub.topic(name).publishMessage(message)`, which publishes one message and returns its id directly.
 *
 * ABORT-SIGNAL NOTE: unlike the AWS/Azure siblings this middleware does NOT thread
 * `OutboundContext.signal` into the SDK call — `Topic.publishMessage` accepts no `AbortSignal` (its
 * gax `CallOptions` carry only timeout/retry settings), so there is nothing to hand the signal to.
 * A deliberate, documented gap rather than a missed transport; revisit if the SDK grows one.
 */
export class PubSubClientMiddleware implements IMiddleware<PubSubSendMessageContext> {
  readonly name = 'PubSubClientMiddleware';

  constructor(private readonly pubSub: PubSub) {}

  async handleAsync(context: PubSubSendMessageContext, _next: NextFunc): Promise<void> {
    context.messageId = await this.pubSub.topic(context.topicName).publishMessage(context.message);
  }
}
