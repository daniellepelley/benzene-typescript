import { IBenzeneResultOf } from '@benzene/abstractions';
import { IBenzeneClientContext } from './IBenzeneClientContext';
import { IBenzeneClientRequest } from './IBenzeneClientRequest';

/**
 * Default `IBenzeneClientContext` implementation.
 * Port of Benzene.Abstractions.Messages.BenzeneClient.BenzeneClientContext&lt;TRequest, TResponse&gt;.
 *
 * Note: the .NET source ships this same concrete class twice — once here in `Benzene.Abstractions.Messages`
 * and once in `Benzene.Core.Messages.MessageSender` — so the port mirrors both, one per package. The core
 * `MessageSender` uses the core-messages copy; this abstractions copy exists to mirror the .NET layout.
 */
export class BenzeneClientContext<TRequest, TResponse> implements IBenzeneClientContext<TRequest, TResponse> {
  readonly request: IBenzeneClientRequest<TRequest>;
  response!: IBenzeneResultOf<TResponse>;

  constructor(request: IBenzeneClientRequest<TRequest>) {
    this.request = request;
  }
}
