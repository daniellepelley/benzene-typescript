/** Port of Benzene.Clients.GoogleCloud.PubSub.OutboundPubSubContextConverter. */
import { ISerializer, VoidResult } from '@benzene/abstractions';
import { IContextConverter } from '@benzene/abstractions-middleware';
import { OutboundContext } from '@benzene/clients';
import { JsonSerializer } from '@benzene/core-message-handlers';
import { BenzeneResult } from '@benzene/results';
import { PubSubPublishMessage, PubSubSendMessageContext } from './PubSubSendMessageContext';

/**
 * Converts an outbound `OutboundContext` into a `PubSubSendMessageContext`, so an outbound route
 * (`OutboundRoutingBuilder.route`) can publish via Pub/Sub. The `OutboundContext` counterpart of the
 * inbound `PubSubMessageTopicGetter`: it writes the Benzene routing topic to the same `"topic"` message
 * attribute the inbound adapter reads (Pub/Sub routes by the attribute, not the Pub/Sub topic name).
 *
 * Pub/Sub is fire-and-acknowledge (a successful publish returns a server message id, no payload), so the
 * mapped response is always an accepted `VoidResult`-typed `IBenzeneResult` — a topic routed here must be
 * sent via `IBenzeneMessageSender.sendAsync<TRequest, VoidResult>`.
 */
export class OutboundPubSubContextConverter
  implements IContextConverter<OutboundContext, PubSubSendMessageContext>
{
  /**
   * The default message-attribute key the routing topic is written to — kept in sync with the inbound
   * consumer's attribute key. Pass a different key to interoperate with a consumer routing on another
   * attribute.
   */
  static readonly DefaultTopicAttribute = 'topic';

  private readonly serializer: ISerializer;
  private readonly topicName: string;

  constructor(
    topic: string,
    private readonly topicAttributeKey: string = OutboundPubSubContextConverter.DefaultTopicAttribute,
    serializer?: ISerializer,
  ) {
    this.topicName = OutboundPubSubContextConverter.resolveTopicName(topic);
    this.serializer = serializer ?? new JsonSerializer();
  }

  // Accept either a full "projects/.../topics/..." path (what Terraform outputs / env vars carry) or a
  // bare topic id combined with the GOOGLE_CLOUD_PROJECT env var (convenient for local/dev).
  private static resolveTopicName(topic: string): string {
    if (topic.startsWith('projects/')) {
      return topic;
    }
    const project = process.env['GOOGLE_CLOUD_PROJECT'] ?? 'local-project';
    return `projects/${project}/topics/${topic}`;
  }

  createRequestAsync(contextIn: OutboundContext): Promise<PubSubSendMessageContext> {
    const attributes: Record<string, string> = {};
    for (const [key, value] of Object.entries(contextIn.headers)) {
      // Pub/Sub rejects an empty attribute value, so skip empty headers rather than fail the publish.
      if (value) {
        attributes[key] = value;
      }
    }
    if (contextIn.topic) {
      attributes[this.topicAttributeKey] = contextIn.topic;
    }

    const message: PubSubPublishMessage = {
      data: Buffer.from(this.serializer.serialize(contextIn.request), 'utf8'),
      attributes,
    };

    return Promise.resolve(new PubSubSendMessageContext(this.topicName, message));
  }

  mapResponseAsync(contextIn: OutboundContext, _contextOut: PubSubSendMessageContext): Promise<void> {
    contextIn.response = BenzeneResult.accepted<VoidResult>(new VoidResult());
    return Promise.resolve();
  }
}
