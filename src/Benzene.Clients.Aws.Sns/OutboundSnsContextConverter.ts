import { MessageAttributeValue, PublishCommandInput } from '@aws-sdk/client-sns';
import { ISerializer, VoidResult } from '@benzenejs/abstractions';
import { IContextConverter } from '@benzenejs/abstractions-middleware';
import { JsonSerializer } from '@benzenejs/core-message-handlers';
import { convertStatusCode, OutboundContext } from '@benzenejs/clients';
import { SnsSendMessageContext } from './SnsSendMessageContext';

/**
 * Converts an outbound `OutboundContext` into an `SnsSendMessageContext`, so a topic routed here is
 * published (fanned out) via SNS. Port of Benzene.Clients.Aws.Sns.OutboundSnsContextConverter.
 *
 * Like SQS, SNS has no request/response beyond a publish acknowledgement, so the response is a
 * `VoidResult`-typed `IBenzeneResult` derived from the publish HTTP status. The topic + per-call headers
 * ride as message attributes (subscribers/filters can route on them).
 */
export class OutboundSnsContextConverter implements IContextConverter<OutboundContext, SnsSendMessageContext> {
  /**
   * The default message-attribute key the topic is written to — the spec's reserved topic name (`topic`,
   * wire-contracts.md §2), the same key the inbound `SnsMessageTopicGetter` reads, so a published message
   * round-trips to a conformant subscriber. Port of the C#
   * `OutboundSnsContextConverter.DefaultTopicAttribute`, which aliases `BenzeneWireNames.DefaultTopic`.
   */
  static readonly DefaultTopicAttribute = 'topic';

  private readonly serializer: ISerializer;

  constructor(
    private readonly topicArn: string,
    private readonly topicAttributeKey: string = OutboundSnsContextConverter.DefaultTopicAttribute,
    serializer?: ISerializer,
  ) {
    this.serializer = serializer ?? new JsonSerializer();
  }

  createRequestAsync(contextIn: OutboundContext): Promise<SnsSendMessageContext> {
    const messageAttributes: Record<string, MessageAttributeValue> = {};
    for (const [key, value] of Object.entries(contextIn.headers)) {
      if (value) {
        messageAttributes[key] = { DataType: 'String', StringValue: value };
      }
    }
    if (contextIn.topic) {
      messageAttributes[this.topicAttributeKey] = { DataType: 'String', StringValue: contextIn.topic };
    }

    const request: PublishCommandInput = {
      TopicArn: this.topicArn,
      Message: this.serializer.serialize(contextIn.request),
      MessageAttributes: messageAttributes,
    };
    const contextOut = new SnsSendMessageContext(request);
    contextOut.signal = contextIn.signal;
    return Promise.resolve(contextOut);
  }

  mapResponseAsync(contextIn: OutboundContext, contextOut: SnsSendMessageContext): Promise<void> {
    const status = contextOut.response?.$metadata?.httpStatusCode ?? 200;
    contextIn.response = convertStatusCode<VoidResult>(status, new VoidResult());
    return Promise.resolve();
  }
}
