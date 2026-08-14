import { tryAddScoped } from '@benzenejs/abstractions';
import { IBenzeneResponseAdapter } from '@benzenejs/abstractions-message-handlers';
import { IMiddlewarePipelineBuilder } from '@benzenejs/abstractions-middleware';
import { AuthenticationHolder } from '@benzenejs/auth-core';
import { IHttpContext, IHttpRequestAdapter } from '@benzenejs/http';
import { BasicAuthMiddleware } from './BasicAuthMiddleware';
import { IBasicAuthCredentialValidator } from './IBasicAuthCredentialValidator';

/**
 * Adds RFC 7617 HTTP Basic authentication middleware to the pipeline. Requests without a valid
 * `Authorization: Basic` header, or whose decoded credentials fail `validator`, are short-circuited
 * with `Unauthorized` (and a `WWW-Authenticate` challenge header); requests that pass have
 * {@link AuthenticationHolder.principal} set for later pipeline steps and continue to `next()`.
 *
 * Port of Benzene.Auth.Basic.Extensions.UseBasicAuth (a C# extension method -> a free function taking
 * the builder as the first argument, the port-wide convention). Registers {@link AuthenticationHolder}
 * scoped here (not centrally) - the Context Purity pattern: a pipeline that never calls
 * `useBasicAuth` never allocates a holder anyone would look at.
 *
 * @param realm The RFC 7617 realm advertised in the `WWW-Authenticate` challenge. Defaults to `"Benzene"`.
 */
export function useBasicAuth<TContext extends IHttpContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  validator: IBasicAuthCredentialValidator,
  realm = 'Benzene',
): IMiddlewarePipelineBuilder<TContext> {
  app.register((x) => {
    tryAddScoped(x, AuthenticationHolder, AuthenticationHolder);
  });

  return app.use(
    (resolver) =>
      new BasicAuthMiddleware<TContext>(
        validator,
        realm,
        resolver.getService(IHttpRequestAdapter) as unknown as IHttpRequestAdapter<TContext>,
        resolver.getService(IBenzeneResponseAdapter) as unknown as IBenzeneResponseAdapter<TContext>,
        resolver.getService(AuthenticationHolder),
        resolver,
      ),
  );
}
