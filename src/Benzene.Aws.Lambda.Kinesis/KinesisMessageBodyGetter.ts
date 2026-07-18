/** Port of Benzene.Aws.Lambda.Kinesis (body getter — see KinesisMessageContext's ADAPTATION note). */
import { IMessageBodyGetter } from '@benzene/abstractions-messages';
import { KinesisMessageContext } from './KinesisMessageContext';

/**
 * Extracts the record body by base64-decoding `record.kinesis.data` to a UTF-8 string. Kinesis delivers
 * the record payload base64-encoded, so this is the port of C# `KinesisRecordData.GetDataAsString()`
 * (`Encoding.UTF8.GetString(Convert.FromBase64String(Data))`), using
 * `Buffer.from(data, 'base64').toString('utf8')`. An empty/absent `data` yields `''`, matching C#
 * (`string.IsNullOrEmpty(Data) ? string.Empty : ...`).
 */
export class KinesisMessageBodyGetter implements IMessageBodyGetter<KinesisMessageContext> {
  getBody(context: KinesisMessageContext): string | undefined {
    const data = context.record.kinesis?.data;
    if (data === undefined || data === '') {
      return '';
    }
    return Buffer.from(data, 'base64').toString('utf8');
  }
}
