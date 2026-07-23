import { IBenzeneServiceContainer, IServiceResolver, tryAddScoped } from '@benzene/abstractions';
import { IMiddleware, IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { FuncWrapperMiddleware } from '@benzene/core-middleware';
import { AuthResults } from './AuthResults';
import { AuthenticationHolder } from './AuthenticationHolder';
import { DelegateAuthorizationPolicy, PolicyPredicate } from './DelegateAuthorizationPolicy';
import { IAuthorizationHandler } from './IAuthorizationHandler';
import { IAuthorizationPolicy } from './IAuthorizationPolicy';
import { RoleClaims } from './RoleClaims';

/**
 * Mechanism-agnostic authorization middleware that builds on the {@link AuthenticationHolder}
 * principal set by an authentication middleware (`useBasicAuth`, or any mechanism that sets a
 * `ClaimsPrincipal`). This is the RBAC/policy layer the auth design deliberately left as an app
 * concern layered on top of the principal - roles, named policies, and resource-based checks -
 * expressed as pipeline middleware.
 *
 * Port of Benzene.Auth.Core.AuthorizationExtensions. C# extension methods on
 * `IMiddlewarePipelineBuilder` / `IBenzeneServiceContainer` become free functions taking the builder/
 * container as the first argument (the port-wide convention). Every check reports `Unauthorized` when
 * no caller is authenticated and `Forbidden` when an authenticated caller lacks permission. Not
 * constrained to an HTTP context: authorization only reads the scoped principal, so it composes on
 * any transport whose pipeline sets one.
 */

/**
 * Requires the authenticated caller to hold at least one of `anyOfRoles`. Roles are read from the
 * common role claim types ({@link import('./Claims/ClaimTypes').ClaimTypes.role}, `role`, `roles` -
 * the last also accepted as a JSON array, Azure AD's app-roles shape). No principal yields
 * `Unauthorized`; an authenticated caller missing every role yields `Forbidden`.
 */
export function requireRole<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  ...anyOfRoles: string[]
): IMiddlewarePipelineBuilder<TContext> {
  app.register((x) => registerHolder(x));

  return app.use(
    (resolver) =>
      new FuncWrapperMiddleware<TContext>('RequireRole', async (context, next) => {
        const holder = resolver.getService(AuthenticationHolder);
        if (holder.principal === undefined) {
          await AuthResults.unauthorizedAsync(resolver, context, 'No authenticated caller');
          return;
        }

        if (!RoleClaims.isInAnyRole(holder.principal, anyOfRoles)) {
          await AuthResults.forbiddenAsync(
            resolver,
            context,
            `Missing required role (any of: ${anyOfRoles.join(', ')})`,
          );
          return;
        }

        await next();
      }),
  );
}

/** Requires the authenticated caller to satisfy the given policy. */
export function requirePolicy<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  policy: IAuthorizationPolicy,
): IMiddlewarePipelineBuilder<TContext>;
/**
 * Requires the authenticated caller to satisfy the registered policy named `policyName`. Resolves an
 * {@link IAuthorizationPolicy} with that name from DI (register it with {@link addAuthorizationPolicy}).
 */
export function requirePolicy<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  policyName: string,
): IMiddlewarePipelineBuilder<TContext>;
/** Requires the authenticated caller to satisfy an inline predicate policy named `policyName`. */
export function requirePolicy<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  policyName: string,
  predicate: PolicyPredicate,
): IMiddlewarePipelineBuilder<TContext>;
export function requirePolicy<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  policyOrName: IAuthorizationPolicy | string,
  predicate?: PolicyPredicate,
): IMiddlewarePipelineBuilder<TContext> {
  app.register((x) => registerHolder(x));

  if (typeof policyOrName === 'string') {
    if (predicate !== undefined) {
      const policy = new DelegateAuthorizationPolicy(policyOrName, predicate);
      return app.use((resolver) => policyMiddleware<TContext>(resolver, policy));
    }

    // Resolve the named policy per message, mirroring C#'s per-invocation `GetServices` lookup.
    return app.use((resolver) => {
      const policy = resolver
        .getServices(IAuthorizationPolicy)
        .find((candidate) => candidate.name === policyOrName);
      if (policy === undefined) {
        throw new Error(
          `No IAuthorizationPolicy named '${policyOrName}' is registered. Register one with addAuthorizationPolicy.`,
        );
      }
      return policyMiddleware<TContext>(resolver, policy);
    });
  }

  return app.use((resolver) => policyMiddleware<TContext>(resolver, policyOrName));
}

/**
 * Requires the authenticated caller to be authorized for a resource derived from the current message,
 * via a registered {@link IAuthorizationHandler}.
 */
export function requireAuthorization<TContext, TResource>(
  app: IMiddlewarePipelineBuilder<TContext>,
  resourceSelector: (context: TContext) => TResource,
): IMiddlewarePipelineBuilder<TContext> {
  app.register((x) => registerHolder(x));

  return app.use(
    (resolver) =>
      new FuncWrapperMiddleware<TContext>('RequireAuthorization', async (context, next) => {
        const holder = resolver.getService(AuthenticationHolder);
        if (holder.principal === undefined) {
          await AuthResults.unauthorizedAsync(resolver, context, 'No authenticated caller');
          return;
        }

        const handler = resolver.getService(
          IAuthorizationHandler,
        ) as unknown as IAuthorizationHandler<TResource>;
        const resource = resourceSelector(context);
        if (!(await handler.isAuthorizedAsync(holder.principal, resource))) {
          await AuthResults.forbiddenAsync(
            resolver,
            context,
            'Not authorized for the requested resource',
          );
          return;
        }

        await next();
      }),
  );
}

/** Registers an {@link IAuthorizationPolicy} so it can be referenced by name. */
export function addAuthorizationPolicy(
  services: IBenzeneServiceContainer,
  policy: IAuthorizationPolicy,
): IBenzeneServiceContainer;
/** Registers an inline predicate policy so it can be referenced by name. */
export function addAuthorizationPolicy(
  services: IBenzeneServiceContainer,
  name: string,
  predicate: PolicyPredicate,
): IBenzeneServiceContainer;
export function addAuthorizationPolicy(
  services: IBenzeneServiceContainer,
  policyOrName: IAuthorizationPolicy | string,
  predicate?: PolicyPredicate,
): IBenzeneServiceContainer {
  const policy =
    typeof policyOrName === 'string'
      ? new DelegateAuthorizationPolicy(policyOrName, predicate as PolicyPredicate)
      : policyOrName;
  services.addSingletonInstance(IAuthorizationPolicy, policy);
  return services;
}

function registerHolder(container: IBenzeneServiceContainer): void {
  tryAddScoped(container, AuthenticationHolder, AuthenticationHolder);
}

function policyMiddleware<TContext>(
  resolver: IServiceResolver,
  policy: IAuthorizationPolicy,
): IMiddleware<TContext> {
  return new FuncWrapperMiddleware<TContext>('RequirePolicy', async (context, next) => {
    const holder = resolver.getService(AuthenticationHolder);
    if (holder.principal === undefined) {
      await AuthResults.unauthorizedAsync(resolver, context, 'No authenticated caller');
      return;
    }

    if (!(await policy.isSatisfiedAsync(holder.principal))) {
      await AuthResults.forbiddenAsync(resolver, context, `Policy '${policy.name}' not satisfied`);
      return;
    }

    await next();
  });
}
