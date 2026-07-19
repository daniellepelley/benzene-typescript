/** Port of Benzene.Aws.Lambda.Kafka.KafkaMessageHeadersGetter. */
import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { KafkaContext } from './KafkaContext';

/**
 * Extracts headers from a Kafka record's FIRST header batch, UTF-8 decoding each value, and adds the Kafka
 * topic name as a `topic` header.
 *
 * FIELD mapping: C# `KafkaEventRecord.Headers.FirstOrDefault()` — `Headers` is a list of header batches,
 * each `IDictionary<string, byte[]>`. In `@types/aws-lambda` `MSKRecord.headers` is `MSKRecordHeader[]`,
 * each `{ [key: string]: number[] }` (byte arrays), so the first batch is `headers[0]` and each value is
 * decoded from its byte array via `Buffer.from(bytes).toString('utf8')` (the port of `Encoding.UTF8.
 * GetString`). Faithful to .NET: when there is NO header batch the result is empty (the `topic` header is
 * only added alongside a present batch).
 */
export class KafkaMessageHeadersGetter implements IMessageHeadersGetter<KafkaContext> {
  getHeaders(context: KafkaContext): Record<string, string> {
    const firstBatch = context.kafkaEventRecord.headers?.[0];

    if (firstBatch === undefined) {
      return {};
    }

    const headers: Record<string, string> = {};
    for (const [key, bytes] of Object.entries(firstBatch)) {
      headers[key] = Buffer.from(bytes).toString('utf8');
    }

    headers['topic'] = context.kafkaEventRecord.topic;

    return headers;
  }
}
