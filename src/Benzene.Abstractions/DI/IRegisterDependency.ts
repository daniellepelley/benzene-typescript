import { IBenzeneServiceContainer } from './IBenzeneServiceContainer';

/**
 * Allows components to register dependencies with the underlying container.
 * Port of Benzene.Abstractions.DI.IRegisterDependency.
 */
export interface IRegisterDependency {
  /** Port of C# `Register(Action<IBenzeneServiceContainer>)`. */
  register(action: (container: IBenzeneServiceContainer) => void): void;
}
