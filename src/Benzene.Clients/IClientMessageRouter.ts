import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { IBenzeneMessageClient } from './IBenzeneMessageClient';

/**
 * Port of Benzene.Clients.IClientMessageRouter.
 *
 * Selects the `IBenzeneMessageClient` to send a given request type through.
 *
 * Deviation: C# `IBenzeneMessageClient GetClient<TRequest>()` keys off the runtime request type,
 * which TypeScript erases. The type parameter is preserved for call-site readability but carries no
 * runtime effect; a router that genuinely needs to discriminate on the request type must obtain it
 * another way (as with the `IGetTopic` deviation).
 */
export interface IClientMessageRouter {
  /** Port of C# `IBenzeneMessageClient GetClient<TRequest>()`. */
  getClient<TRequest>(): IBenzeneMessageClient;
}

export const IClientMessageRouter: ServiceToken<IClientMessageRouter> =
  serviceToken<IClientMessageRouter>('IClientMessageRouter');
