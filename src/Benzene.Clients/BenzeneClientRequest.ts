import { IBenzeneClientRequest } from '@benzene/abstractions-messages';

/**
 * Port of Benzene.Clients.BenzeneClientRequest&lt;TMessage&gt;.
 *
 * Note: the .NET source ships this identical concrete class in two projects — here in
 * `Benzene.Clients` and in `Benzene.Core.Messages.MessageSender` (the port of the latter lives in
 * `@benzene/core-messages`). The port mirrors both, one per package, exactly as it does for
 * `BenzeneClientContext` (see that class's shipped-twice note). Keeping a local copy lets
 * `@benzene/clients` depend only on `@benzene/abstractions-messages` + `@benzene/results`, matching
 * the .NET `Benzene.Clients.csproj` references (which do not include `Benzene.Core.Messages`).
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
