import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { ClaimsPrincipal } from './Claims/ClaimsPrincipal';

/**
 * A named authorization rule evaluated against the authenticated caller. Benzene owns the
 * *enforcement* mechanism (`requirePolicy` short-circuits with `Forbidden` when a policy isn't
 * satisfied); an application implements this interface to define what a policy actually *means*,
 * keeping domain rules out of the framework.
 *
 * Port of Benzene.Auth.Core.IAuthorizationPolicy.
 *
 * Principal-based by design: a rule that needs the specific resource being acted on (e.g. "the caller
 * owns this order") is a resource decision - use {@link IAuthorizationHandler} with
 * `requireAuthorization` for that. Register policies with `addAuthorizationPolicy` to reference them
 * by name.
 */
export interface IAuthorizationPolicy {
  /** The policy's name, used to reference it from `requirePolicy(name)`. */
  readonly name: string;

  /** Returns whether the authenticated caller satisfies this policy. */
  isSatisfiedAsync(principal: ClaimsPrincipal): Promise<boolean>;
}

export const IAuthorizationPolicy: ServiceToken<IAuthorizationPolicy> =
  serviceToken<IAuthorizationPolicy>('IAuthorizationPolicy');
