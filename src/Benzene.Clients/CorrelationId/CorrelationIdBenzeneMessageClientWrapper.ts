import { ICorrelationId, IDependencyWrapper, IServiceResolver } from '@benzene/abstractions';
import { IBenzeneMessageClient } from '../IBenzeneMessageClient';
import { CorrelationIdBenzeneMessageClient } from './CorrelationIdBenzeneMessageClient';

/**
 * Port of Benzene.Clients.CorrelationId.CorrelationIdBenzeneMessageClientWrapper.
 *
 * The `IDependencyWrapper<IBenzeneMessageClient>` that wraps a resolved client in a
 * `CorrelationIdBenzeneMessageClient`, resolving `ICorrelationId` from the scope (C#
 * `serviceResolver.Resolve<ICorrelationId>()` -> `serviceResolver.getService(ICorrelationId)`).
 */
export class CorrelationIdBenzeneMessageClientWrapper implements IDependencyWrapper<IBenzeneMessageClient> {
  wrap(serviceResolver: IServiceResolver, benzeneMessageClient: IBenzeneMessageClient): IBenzeneMessageClient {
    return new CorrelationIdBenzeneMessageClient(benzeneMessageClient, serviceResolver.getService(ICorrelationId));
  }
}
