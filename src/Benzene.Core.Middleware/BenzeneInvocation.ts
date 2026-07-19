import { ServiceIdentifier } from '@benzene/abstractions';
import { IBenzeneInvocation, IBenzeneInvocationAccessor } from '@benzene/abstractions-middleware';

/**
 * Port of Benzene.Core.Middleware.BenzeneInvocation.
 *
 * Default `IBenzeneInvocation` implementation, holding an invocation ID, platform identifier, and a bag
 * of native platform features keyed by identifier.
 *
 * ADAPTATION — the feature bag. C# uses `IReadOnlyDictionary<Type, object>` keyed by the feature's
 * runtime `Type`. TypeScript erases types, so the bag is a `ReadonlyMap<ServiceIdentifier<unknown>,
 * unknown>` keyed by the same `ServiceToken`/constructor stand-ins the container uses; `getFeature`
 * takes the identifier explicitly (see `IBenzeneInvocation.getFeature`) rather than a bare type
 * parameter, and casts the stored value to `T`.
 */
export class BenzeneInvocation implements IBenzeneInvocation {
  private readonly features: ReadonlyMap<ServiceIdentifier<unknown>, unknown>;

  /**
   * @param invocationId The invocation identifier.
   * @param platform The hosting platform identifier.
   * @param features The native platform features available for this invocation, keyed by identifier.
   */
  constructor(
    public readonly invocationId: string,
    public readonly platform: string,
    features: ReadonlyMap<ServiceIdentifier<unknown>, unknown>,
  ) {
    this.features = features;
  }

  getFeature<T>(feature: ServiceIdentifier<T>): T | undefined {
    return this.features.has(feature) ? (this.features.get(feature) as T) : undefined;
  }
}

/**
 * Port of Benzene.Core.Middleware.BenzeneInvocationAccessor.
 *
 * Default `IBenzeneInvocationAccessor` implementation: a plain scoped mutable holder.
 */
export class BenzeneInvocationAccessor implements IBenzeneInvocationAccessor {
  invocation: IBenzeneInvocation | undefined = undefined;
}
