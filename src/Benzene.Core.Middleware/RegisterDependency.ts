import { IBenzeneServiceContainer, IRegisterDependency } from '@benzene/abstractions';

/**
 * Applies registration actions directly to a service container.
 * Port of Benzene.Core.Middleware.RegisterDependency.
 */
export class RegisterDependency implements IRegisterDependency {
  constructor(private readonly benzeneServiceContainer: IBenzeneServiceContainer) {}

  register(action: (container: IBenzeneServiceContainer) => void): void {
    action(this.benzeneServiceContainer);
  }
}
