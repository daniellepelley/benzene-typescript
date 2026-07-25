/** Port of Benzene.Aws.Lambda.Sns.TestHelpers.MessageBuilderExtensions. */
import { SNSEvent, SNSEventRecord } from 'aws-lambda';
import { IMessageBuilder } from '@benzene/abstractions';
import { MessageSerializer } from '@benzene/testing';
import { jsonMessageSerializer } from './defaults';

export interface AsSnsOptions {
  serializer?: MessageSerializer;
}

/**
 * Builds an `SNSEvent` from a message builder: the topic (plus every header) becomes a `String`
 * message attribute, the serialized message becomes `Sns.Message`. Port of
 * `Benzene.Aws.Lambda.Sns.TestHelpers.MessageBuilderExtensions.AsSns`.
 */
export function asSns<T>(source: IMessageBuilder<T>, options: AsSnsOptions = {}): SNSEvent {
  const { serializer = jsonMessageSerializer } = options;
  const attributes = { ...source.headers, topic: source.topic };

  const record: SNSEventRecord = {
    EventVersion: '1.0',
    EventSubscriptionArn: 'arn:aws:sns:eu-west-1:123456789012:topic:subscription',
    EventSource: 'aws:sns',
    Sns: {
      Type: 'Notification',
      MessageId: 'message-1',
      TopicArn: 'arn:aws:sns:eu-west-1:123456789012:topic',
      Message: serializer.serialize(source.message),
      Timestamp: '1970-01-01T00:00:00.000Z',
      SignatureVersion: '1',
      Signature: 'sig',
      SigningCertUrl: 'https://sns.eu-west-1.amazonaws.com/cert.pem',
      UnsubscribeUrl: 'https://sns.eu-west-1.amazonaws.com/unsubscribe',
      MessageAttributes: Object.fromEntries(
        Object.entries(attributes).map(([key, value]) => [key, { Type: 'String', Value: value }]),
      ),
    },
  };

  return { Records: [record] };
}
