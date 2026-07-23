import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { ClaimsPrincipal } from './Claims/ClaimsPrincipal';

/**
 * A resource-based authorization hook: decides whether the authenticated caller may act on a specific
 * resource. Register an implementation in DI and enforce it with `requireAuthorization<TContext,
 * TResource>`, which maps the current message's context to a `TResource` and calls this handler.
 * Benzene owns the enforcement; the application owns what "authorized for this resource" means.
 *
 * Port of Benzene.Auth.Core.IAuthorizationHandler&lt;TResource&gt;.
 *
 * The resource is derived from the transport context (topic, headers, body, or a route/query value)
 * because authorization runs before the pipeline maps the request into a typed handler argument.
 * Where a decision needs the fully-deserialized request, do the check inside the handler against the
 * same {@link AuthenticationHolder} principal instead.
 */
export interface IAuthorizationHandler<TResource> {
  /** Returns whether the caller is authorized for the given resource. */
  isAuthorizedAsync(principal: ClaimsPrincipal, resource: TResource): Promise<boolean>;
}

/**
 * Shared container token for `IAuthorizationHandler<TResource>`. C#'s open-generic registration
 * (`AddScoped(typeof(IAuthorizationHandler<>), ...)`) has no erased-generic equivalent in TypeScript,
 * so - following the `<unknown>` precedent used across the port (`IBenzeneResponseAdapter`,
 * `IMessageGetter`) - every resource handler registers under this one token and `requireAuthorization`
 * casts the resolved handler back to its `TResource`.
 */
export const IAuthorizationHandler: ServiceToken<IAuthorizationHandler<unknown>> =
  serviceToken<IAuthorizationHandler<unknown>>('IAuthorizationHandler');
