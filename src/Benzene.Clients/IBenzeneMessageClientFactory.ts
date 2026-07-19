import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { IBenzeneMessageClient } from './IBenzeneMessageClient';

/**
 * Port of Benzene.Clients.IBenzeneMessageClientFactory.
 *
 * Resolves an `IBenzeneMessageClient` either as the sole registered client or by (service, topic).
 * C#'s arity-overloaded `Create()` / `Create(service, topic)` map to a single method with optional
 * arguments, since the two are distinguishable by argument count.
 */
export interface IBenzeneMessageClientFactory {
  /** Port of C# `IBenzeneMessageClient Create()` and `Create(string service, string topic)`. */
  create(service?: string, topic?: string): IBenzeneMessageClient;
}

export const IBenzeneMessageClientFactory: ServiceToken<IBenzeneMessageClientFactory> =
  serviceToken<IBenzeneMessageClientFactory>('IBenzeneMessageClientFactory');
