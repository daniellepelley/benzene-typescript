/** Port of Benzene.GoogleCloud.Functions.Http — the UseHttp wiring (Benzene.AspNet.Core.BenzeneExtensions.UseHttp analog). */
import { PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { MiddlewareApplication } from '@benzene/core-middleware';
import { addExpress, ExpressContext } from '@benzene/express';
import { Request } from '@google-cloud/functions-framework';
import { GoogleCloudFunctionApplicationBuilder } from './GoogleCloudFunctionApplicationBuilder';

/**
 * Configures the HTTP pipeline a Google Cloud Functions HTTP trigger dispatches through, and registers
 * the request handler that runs it.
 *
 * ASP.NET → EXPRESS ADAPTATION: the .NET reference calls `app.UseHttp(...)` from
 * `Benzene.AspNet.Core`, which is a no-op unless the builder is an `IAspApplicationBuilder`. That stack
 * is .NET-specific and unported; `@benzene/express` is its Node analog and the Functions Framework's
 * HTTP model is Express req/res, so this reuses Express's `addExpress` + `ExpressContext` machinery to
 * bridge into the Benzene HTTP pipeline (the same construction `@benzene/express`'s `benzene()`
 * middleware performs). Because the startup's `configure` is typed to receive the concrete
 * {@link GoogleCloudFunctionApplicationBuilder}, this takes it directly rather than doing C#'s
 * `is IAspApplicationBuilder` runtime narrowing.
 *
 * Register `addExpress`, build the `ExpressContext` pipeline from `action`, then store a factory that —
 * per invocation — reads the raw body, maps the Functions Framework req/res into an `ExpressContext`,
 * and runs it through the pipeline (the response handlers write back to `res` via
 * `ExpressResponseAdapter.finalizeAsync`). The startup's `configureServices` must have registered the
 * Benzene core (`addBenzene`), exactly as the AWS/Azure `use*` extensions expect.
 *
 * @param app The Google Cloud Functions application builder passed to the startup's `configure`.
 * @param action Configures the HTTP middleware pipeline (e.g. `(http) => useMessageHandlers(http, ...)`).
 * @returns `app`, for chaining.
 */
export function useHttp(
  app: GoogleCloudFunctionApplicationBuilder,
  action: PipelineBuilderAction<ExpressContext>,
): GoogleCloudFunctionApplicationBuilder {
  app.register((x) => addExpress(x));
  const pipeline = app.create<ExpressContext>();
  action(pipeline);
  const built = pipeline.build();

  app.add((serviceResolverFactory) => {
    const application = new MiddlewareApplication<ExpressContext, ExpressContext>(built, (c) => c);
    return async (req, res) => {
      await application.handleAsync(new ExpressContext(req, res, readRawBody(req)), serviceResolverFactory);
    };
  });

  return app;
}

/**
 * Reads the raw request body string from a Functions Framework request. The Functions Framework buffers
 * the raw bytes on `req.rawBody` (and parses `req.body`); prefer the raw buffer, falling back to an
 * already-parsed body (re-serializing a parsed object as a best-effort fallback, mirroring
 * `@benzene/express`'s body handling), and to an empty string when there is no body.
 */
function readRawBody(req: Request): string {
  if (req.rawBody !== undefined) {
    return req.rawBody.toString('utf8');
  }
  const body: unknown = req.body;
  if (typeof body === 'string') {
    return body;
  }
  if (body !== undefined && body !== null) {
    return JSON.stringify(body);
  }
  return '';
}
