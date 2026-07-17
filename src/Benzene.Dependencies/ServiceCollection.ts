import { ServiceIdentifier } from '@benzene/abstractions';

/** Service lifetime, mirroring Microsoft.Extensions.DependencyInjection lifetimes. */
export type ServiceLifetime = 'singleton' | 'scoped' | 'transient';

export interface ServiceDescriptor {
  readonly lifetime: ServiceLifetime;
  /** Creates the instance. For instance registrations this returns the pre-built instance. */
  readonly factory: (resolver: import('@benzene/abstractions').IServiceResolver) => unknown;
  /** True when the descriptor wraps a caller-provided instance the container must not dispose. */
  readonly isExternalInstance: boolean;
}

/**
 * An ordered collection of service registrations.
 * Counterpart of `Microsoft.Extensions.DependencyInjection.ServiceCollection`,
 * which the .NET version of Benzene builds on; Node has no platform container,
 * so the TypeScript port ships its own.
 */
export class ServiceCollection {
  private readonly descriptors = new Map<ServiceIdentifier<unknown>, ServiceDescriptor[]>();

  add(identifier: ServiceIdentifier<unknown>, descriptor: ServiceDescriptor): void {
    const existing = this.descriptors.get(identifier);
    if (existing) {
      existing.push(descriptor);
    } else {
      this.descriptors.set(identifier, [descriptor]);
    }
  }

  has(identifier: ServiceIdentifier<unknown>): boolean {
    return this.descriptors.has(identifier);
  }

  /** Returns all descriptors for an identifier, in registration order. */
  getDescriptors(identifier: ServiceIdentifier<unknown>): ServiceDescriptor[] {
    return this.descriptors.get(identifier) ?? [];
  }
}
