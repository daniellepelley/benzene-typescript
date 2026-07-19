import { IBenzeneServiceContainer, IServiceResolver } from '@benzene/abstractions';
import { IBenzeneMessageClient } from './IBenzeneMessageClient';

/**
 * Port of Benzene.Clients.SingleClientsBuilder.
 *
 * Registers one or more `IBenzeneMessageClient` builders directly as scoped `IBenzeneMessageClient`
 * factories (no factory indirection). C# `Func<IServiceResolver, IBenzeneMessageClient>` maps to
 * `(resolver) => client`; `AddScoped<IBenzeneMessageClient>(builder)` maps to `addScopedFactory`.
 */
export class SingleClientsBuilder {
  private readonly builders: Array<(serviceResolver: IServiceResolver) => IBenzeneMessageClient> = [];

  register(benzeneServiceContainer: IBenzeneServiceContainer): void {
    for (const builder of this.builders) {
      benzeneServiceContainer.addScopedFactory(IBenzeneMessageClient, builder);
    }
  }

  withMessageClient(builder: (serviceResolver: IServiceResolver) => IBenzeneMessageClient): void {
    this.builders.push(builder);
  }
}
