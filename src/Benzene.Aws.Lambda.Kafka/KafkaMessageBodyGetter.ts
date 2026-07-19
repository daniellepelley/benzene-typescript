/** Port of Benzene.Aws.Lambda.Kafka.KafkaMessageBodyGetter. */
import { IMessageBodyGetter } from '@benzene/abstractions-messages';
import { KafkaContext } from './KafkaContext';

/**
 * Extracts and UTF-8 decodes the message body from a Kafka record's value.
 *
 * FIELD mapping: the .NET `KafkaEventRecord.Value` is a decoded byte `Stream` (C# reads it with a
 * `StreamReader(..., UTF8)`). In `@types/aws-lambda` `MSKRecord.value` is instead the raw BASE64 string, so
 * the port base64-decodes it and then decodes the bytes as UTF-8 — the same resulting text.
 */
export class KafkaMessageBodyGetter implements IMessageBodyGetter<KafkaContext> {
  getBody(context: KafkaContext): string | undefined {
    return Buffer.from(context.kafkaEventRecord.value, 'base64').toString('utf8');
  }
}
