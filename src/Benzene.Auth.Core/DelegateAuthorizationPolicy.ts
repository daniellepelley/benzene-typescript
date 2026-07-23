import { ClaimsPrincipal } from './Claims/ClaimsPrincipal';
import { IAuthorizationPolicy } from './IAuthorizationPolicy';

/** A policy predicate: sync or async. Ports both C# `Func<ClaimsPrincipal, bool>` and `Func<ClaimsPrincipal, Task<bool>>`. */
export type PolicyPredicate = (principal: ClaimsPrincipal) => boolean | Promise<boolean>;

/**
 * An {@link IAuthorizationPolicy} backed by an inline predicate, so a simple policy can be defined
 * without a dedicated class. Used by the `requirePolicy(name, predicate)` and
 * `addAuthorizationPolicy(name, predicate)` convenience overloads.
 *
 * Port of Benzene.Auth.Core.DelegateAuthorizationPolicy. C#'s two constructors (sync and async
 * predicate) collapse into one, since a single {@link PolicyPredicate} covers both and `isSatisfiedAsync`
 * normalizes the result to a promise.
 */
export class DelegateAuthorizationPolicy implements IAuthorizationPolicy {
  readonly name: string;
  private readonly predicate: PolicyPredicate;

  constructor(name: string, predicate: PolicyPredicate) {
    this.name = name;
    this.predicate = predicate;
  }

  isSatisfiedAsync(principal: ClaimsPrincipal): Promise<boolean> {
    return Promise.resolve(this.predicate(principal));
  }
}
