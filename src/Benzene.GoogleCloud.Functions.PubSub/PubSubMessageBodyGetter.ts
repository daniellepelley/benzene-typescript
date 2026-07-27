/** Port of Benzene.GoogleCloud.Functions.PubSub.PubSubMessageBodyGetter. */
import { IMessageBodyGetter } from '@benzene/abstractions-messages';
import { PubSubContext } from './PubSubContext';

/**
 * Extracts the message body from a Pub/Sub message's data payload.
 *
 * MESSAGE-TYPE ADAPTATION: C# returns `context.Message.TextData`, the generated protobuf convenience that
 * UTF-8 decodes the binary `Data`. The CloudEvent JSON carries that payload base64-encoded on
 * `message.data`, so this decodes it: base64 → UTF-8 string (the port's re-creation of `TextData`). An
 * absent payload yields `''`, matching `TextData`'s empty-string result for an empty `Data`.
 */
export class PubSubMessageBodyGetter implements IMessageBodyGetter<PubSubContext> {
  getBody(context: PubSubContext): string {
    const data = context.message.data;
    return data ? Buffer.from(data, 'base64').toString('utf8') : '';
  }
}
