import { IBenzeneClientRequest } from '@benzene/abstractions-messages';

/**
 * Default `IBenzeneClientRequest` implementation carrying the topic, message and headers of an
 * outbound send.
 * Port of Benzene.Core.Messages.MessageSender.BenzeneClientRequest&lt;TMessage&gt;.
 */
export class BenzeneClientRequest<TMessage> implements IBenzeneClientRequest<TMessage> {
  readonly topic: string;
  readonly message: TMessage;
  readonly headers: Record<string, string>;

  constructor(topic: string, message: TMessage, headers: Record<string, string>) {
    this.topic = topic;
    this.message = message;
    this.headers = headers;
  }
}
