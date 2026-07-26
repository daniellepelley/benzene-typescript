import { MessageAttributeValue, PublishCommandInput } from '@aws-sdk/client-sns';
import { ISerializer, VoidResult } from '@benzene/abstractions';
import { IContextConverter } from '@benzene/abstractions-middleware';
import { JsonSerializer } from '@benzene/core-message-handlers';
import { convertStatusCode, OutboundContext } from '@benzene/clients';
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
  static readonly DefaultTopicAttribute = 'benzene-topic';

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
    return Promise.resolve(new SnsSendMessageContext(request));
  }

  mapResponseAsync(contextIn: OutboundContext, contextOut: SnsSendMessageContext): Promise<void> {
    const status = contextOut.response?.$metadata?.httpStatusCode ?? 200;
    contextIn.response = convertStatusCode<VoidResult>(status, new VoidResult());
    return Promise.resolve();
  }
}
