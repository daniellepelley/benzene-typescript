import { JWTVerifyOptions } from 'jose';
import { ILoggerFactory, NullLogger, tryAddScoped } from '@benzene/abstractions';
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { AuthenticationHolder, AuthResults } from '@benzene/auth-core';
import { FuncWrapperMiddleware } from '@benzene/core-middleware';
import { IHttpContext, IHttpRequestAdapter } from '@benzene/http';
import { OAuth2BearerMiddleware } from './OAuth2BearerMiddleware';
import { OAuth2BearerOptions } from './OAuth2BearerOptions';
import { OAuth2ConfigurationManagerFactory } from './OAuth2ConfigurationManagerFactory';
import { ScopeClaims } from './ScopeClaims';

const loggerCategory = 'Benzene.Auth.OAuth2';

/**
 * Adds OAuth2 bearer token (JWT) validation middleware to the pipeline. Requests without a valid
 * `Authorization: Bearer` header, or whose token fails validation (bad signature, expired, wrong
 * issuer/audience/algorithm), are short-circuited with `Unauthorized` and a generic detail message -
 * the real reason is logged server-side only, never returned to the caller. Requests that pass have
 * {@link AuthenticationHolder.principal} set for later pipeline steps (including {@link requireScope})
 * and continue to `next()`.
 *
 * Port of Benzene.Auth.OAuth2.Extensions.UseOAuth2Bearer (a C# extension method -> a free function
 * taking the builder as the first argument). `options` is validated at wire-up time
 * ({@link OAuth2BearerOptions.validate}): it throws immediately, not on the first request, if
 * authority/jwksUri aren't set exactly one at a time, or if the issuer/audience/algorithm allowlists are
 * empty. The caching JWKS key resolver and verify options are built once here and shared across every
 * request - not rebuilt per message.
 */
export function useOAuth2Bearer<TContext extends IHttpContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  options: OAuth2BearerOptions,
): IMiddlewarePipelineBuilder<TContext> {
  options.validate();

  const keyResolver = OAuth2ConfigurationManagerFactory.create(options);
  const verifyOptions: JWTVerifyOptions = {
    issuer: options.validIssuers,
    audience: options.validAudiences,
    algorithms: options.validAlgorithms,
    clockTolerance: options.clockToleranceSeconds,
  };

  app.register((x) => {
    tryAddScoped(x, AuthenticationHolder, AuthenticationHolder);
  });

  return app.use(
    (resolver) =>
      new OAuth2BearerMiddleware<TContext>(
        keyResolver,
        verifyOptions,
        resolver.getService(IHttpRequestAdapter) as unknown as IHttpRequestAdapter<TContext>,
        resolver.getService(AuthenticationHolder),
        resolver.tryGetService(ILoggerFactory)?.createLogger(loggerCategory) ?? NullLogger.instance,
        resolver,
      ),
  );
}

/**
 * Adds authorization middleware that requires the current message's authenticated caller (set by
 * {@link useOAuth2Bearer}, earlier in the pipeline) to hold at least one of `anyOfScopes`, read from
 * either the `scope` claim (RFC 8693, space-delimited) or the `scp` claim (Azure AD's convention - a
 * space-delimited string OR a JSON array, depending on issuer; both are normalized).
 *
 * Port of Benzene.Auth.OAuth2.Extensions.RequireScope. No principal at all (no authentication middleware
 * ran, or the one that ran failed) yields `Unauthorized` - not `Forbidden`. A principal missing every
 * requested scope yields `Forbidden`. Lives here rather than in `@benzene/auth-core` because scopes are
 * specifically an OAuth2/JWT concept, not a mechanism-agnostic one.
 */
export function requireScope<TContext extends IHttpContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  ...anyOfScopes: string[]
): IMiddlewarePipelineBuilder<TContext> {
  app.register((x) => {
    tryAddScoped(x, AuthenticationHolder, AuthenticationHolder);
  });

  return app.use(
    (resolver) =>
      new FuncWrapperMiddleware<TContext>('RequireScope', async (context, next) => {
        const holder = resolver.getService(AuthenticationHolder);
        if (holder.principal === undefined) {
          await AuthResults.unauthorizedAsync(resolver, context, 'No authenticated caller');
          return;
        }

        const granted = ScopeClaims.getGrantedScopes(holder.principal);
        if (!anyOfScopes.some((scope) => granted.has(scope))) {
          await AuthResults.forbiddenAsync(
            resolver,
            context,
            `Missing required scope (any of: ${anyOfScopes.join(', ')})`,
          );
          return;
        }

        await next();
      }),
  );
}
