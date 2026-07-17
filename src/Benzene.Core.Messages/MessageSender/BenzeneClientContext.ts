import { IBenzeneResultOf } from '@benzene/abstractions';
import { IBenzeneClientContext, IBenzeneClientRequest } from '@benzene/abstractions-messages';

/**
 * Default `IBenzeneClientContext` implementation used by `MessageSender`.
 * Port of Benzene.Core.Messages.MessageSender.BenzeneClientContext&lt;TRequest, TResponse&gt;.
 *
 * The .NET source ships this identical concrete class in both `Benzene.Core.Messages.MessageSender`
 * and `Benzene.Abstractions.Messages.BenzeneClient`; the port mirrors both. This is the copy
 * `MessageSender` constructs.
 */
export class BenzeneClientContext<TRequest, TResponse> implements IBenzeneClientContext<TRequest, TResponse> {
  readonly request: IBenzeneClientRequest<TRequest>;
  response!: IBenzeneResultOf<TResponse>;

  constructor(request: IBenzeneClientRequest<TRequest>) {
    this.request = request;
  }
}
