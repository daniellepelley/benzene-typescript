import { MessageAttributeValue, SendMessageCommandInput } from '@aws-sdk/client-sqs';
import { ISerializer, VoidResult } from '@benzene/abstractions';
import { IContextConverter } from '@benzene/abstractions-middleware';
import { JsonSerializer } from '@benzene/core-message-handlers';
import { convertStatusCode, OutboundContext } from '@benzene/clients';
import { SqsSendMessageContext } from './SqsSendMessageContext';

/**
 * Converts an outbound `OutboundContext` (an `OutboundRoutingBuilder.route` pipeline) into an
 * `SqsSendMessageContext`, so a topic routed here is sent via SQS.
 * Port of Benzene.Clients.Aws.Sqs.OutboundSqsContextConverter.
 *
 * SQS has no request/response semantics beyond a send acknowledgement, so the mapped response is always a
 * `VoidResult`-typed `IBenzeneResult` (derived from the send's HTTP status via `convertStatusCode`, the
 * inverse of the HTTP status-code mapper) — a topic routed here must be sent via
 * `IBenzeneMessageSender.sendAsync<TRequest, VoidResult>`.
 */
export class OutboundSqsContextConverter implements IContextConverter<OutboundContext, SqsSendMessageContext> {
  /**
   * The default message-attribute key the topic is written to. A single default, not a hard-coded value —
   * pass a different key to interoperate with a consumer that routes on another attribute; keep it in sync
   * with the consumer's attribute key.
   */
  static readonly DefaultTopicAttribute = 'benzene-topic';

  private readonly serializer: ISerializer;

  constructor(
    private readonly queueUrl: string,
    private readonly topicAttributeKey: string = OutboundSqsContextConverter.DefaultTopicAttribute,
    serializer?: ISerializer,
  ) {
    this.serializer = serializer ?? new JsonSerializer();
  }

  createRequestAsync(contextIn: OutboundContext): Promise<SqsSendMessageContext> {
    const messageAttributes: Record<string, MessageAttributeValue> = {};
    for (const [key, value] of Object.entries(contextIn.headers)) {
      // SQS rejects a message attribute with an empty value, so skip empty headers rather than fail the send.
      if (value) {
        messageAttributes[key] = { DataType: 'String', StringValue: value };
      }
    }
    if (contextIn.topic) {
      messageAttributes[this.topicAttributeKey] = { DataType: 'String', StringValue: contextIn.topic };
    }

    const request: SendMessageCommandInput = {
      QueueUrl: this.queueUrl,
      MessageBody: this.serializer.serialize(contextIn.request),
      MessageAttributes: messageAttributes,
    };
    return Promise.resolve(new SqsSendMessageContext(request));
  }

  mapResponseAsync(contextIn: OutboundContext, contextOut: SqsSendMessageContext): Promise<void> {
    const status = contextOut.response?.$metadata?.httpStatusCode ?? 200;
    contextIn.response = convertStatusCode<VoidResult>(status, new VoidResult());
    return Promise.resolve();
  }
}
