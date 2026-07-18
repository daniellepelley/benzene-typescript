/** Port of Benzene.Aws.Lambda.Kinesis (headers getter — see KinesisMessageContext's ADAPTATION note). */
import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { KinesisMessageContext } from './KinesisMessageContext';

/**
 * Exposes the Kinesis record's envelope metadata as `kinesis-`-prefixed headers, mirroring how the ported
 * DynamoDB adapter surfaces `dynamodb-`-prefixed metadata. This is an ADAPTER-SPECIFIC addition (the C#
 * streaming model has no per-record headers getter, since it never routes records to handlers) that keeps
 * the fan-out shape consistent with the other AWS record sources. There is no embedded Benzene wire-header
 * convention here — Kinesis records originate from stream producers, not necessarily a Benzene publisher.
 */
export class KinesisMessageHeadersGetter implements IMessageHeadersGetter<KinesisMessageContext> {
  getHeaders(context: KinesisMessageContext): Record<string, string> {
    const record = context.record;
    const headers: Record<string, string> = {};

    addIfPresent(headers, 'kinesis-event-id', record.eventID);
    addIfPresent(headers, 'kinesis-event-name', record.eventName);
    addIfPresent(headers, 'kinesis-partition-key', record.kinesis?.partitionKey);
    addIfPresent(headers, 'kinesis-sequence-number', record.kinesis?.sequenceNumber);
    addIfPresent(headers, 'kinesis-event-source-arn', record.eventSourceARN);
    addIfPresent(headers, 'kinesis-aws-region', record.awsRegion);

    return headers;
  }
}

function addIfPresent(
  headers: Record<string, string>,
  key: string,
  value: string | undefined,
): void {
  if (value !== undefined && value !== '') {
    headers[key] = value;
  }
}
