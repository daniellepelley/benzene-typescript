import { IDependencyWrapper, IServiceResolver } from '@benzene/abstractions';
import { IBenzeneMessageClient } from './IBenzeneMessageClient';
import { RetryBenzeneMessageClient } from './RetryBenzeneMessageClient';

/**
 * Port of Benzene.Clients.RetryBenzeneMessageClientWrapper.
 *
 * The `IDependencyWrapper<IBenzeneMessageClient>` that wraps a resolved client in a
 * `RetryBenzeneMessageClient` with the configured attempt count.
 */
export class RetryBenzeneMessageClientWrapper implements IDependencyWrapper<IBenzeneMessageClient> {
  constructor(private readonly numberOfRetries: number) {}

  wrap(_serviceResolver: IServiceResolver, benzeneMessageClient: IBenzeneMessageClient): IBenzeneMessageClient {
    return new RetryBenzeneMessageClient(benzeneMessageClient, this.numberOfRetries);
  }
}
