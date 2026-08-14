/** Port of Benzene.Spec.Ui.SpecUiExtensions. */
import { ServiceIdentifier } from '@benzenejs/abstractions';
import { IBenzeneResponseAdapter } from '@benzenejs/abstractions-message-handlers';
import { IMiddleware, IMiddlewarePipelineBuilder } from '@benzenejs/abstractions-middleware';
import { IHttpContext, IHttpRequestAdapter } from '@benzenejs/http';
import { SpecUiMiddleware } from './SpecUiMiddleware';

/** The default path the spec UI is served from. */
export const DefaultSpecUiPath = '/spec-ui';

/** The default URL the UI fetches the benzene spec JSON from. */
export const DefaultSpecUrl = '/spec?type=benzene';

/**
 * Serves the Benzene Spec Explorer page at `path` on any HTTP pipeline — the equivalent of `UseSwaggerUI()`,
 * but for the benzene message spec (topics, payloads, validation rules) and transport-agnostic. The page
 * fetches the spec JSON from `specUrl` on load, so expose a benzene `spec` endpoint (e.g. `useSpec()` mapped
 * to `GET /spec`) alongside it. Add this before the message-handler middleware. C# extension method → free
 * function taking the pipeline builder first.
 */
export function useSpecUi<TContext extends IHttpContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  path: string = DefaultSpecUiPath,
  specUrl: string = DefaultSpecUrl,
): IMiddlewarePipelineBuilder<TContext> {
  app.register((container) => {
    container.addSingletonFactory(
      SpecUiMiddleware,
      (resolver) =>
        new SpecUiMiddleware<TContext>(
          path,
          specUrl,
          resolver.getService(IHttpRequestAdapter) as IHttpRequestAdapter<TContext>,
          resolver.getService(IBenzeneResponseAdapter) as IBenzeneResponseAdapter<TContext>,
        ),
    );
  });
  return app.useService(SpecUiMiddleware as unknown as ServiceIdentifier<IMiddleware<TContext>>);
}
