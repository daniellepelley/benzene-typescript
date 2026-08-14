import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { PipelineBuilderAction } from '@benzenejs/abstractions-middleware';
import { addBenzene } from '@benzenejs/core-message-handlers';
import { MiddlewareApplication, MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { IRouteFinder } from '@benzenejs/http';
import { ExpressContext } from './ExpressContext';
import { addExpress } from './DependencyInjectionExtensions';
import { BenzeneExpressMiddleware, ExpressRequestLike } from './types';

/** Options for {@link benzene}. */
export interface BenzeneExpressOptions {
  /**
   * A pre-built service container to register into (e.g. to share DI with the rest of the app). Defaults
   * to a fresh {@link DefaultBenzeneServiceContainer}.
   */
  container?: IBenzeneServiceContainer;
}

/**
 * Builds an Express/Connect middleware that lets Benzene handle the HTTP verbs + URLs it has message
 * handlers for, and transparently falls through to the rest of the Express pipeline for everything else -
 * the strangler-fig pattern for introducing Benzene into an existing Express app. The Node/JS equivalent
 * of `Benzene.AspNet.Core`'s `UseBenzene` (ASP.NET Core is .NET-specific; Express is the JS host, adapted
 * per the "third-party integrations are adapted, not reimplemented" convention).
 *
 * Usage:
 * ```ts
 * app.use(benzene((pipeline) => {
 *   useMessageHandlers(pipeline, CreateOrderHandler); // @httpEndpoint('POST', '/orders') + @message(...)
 * }));
 * app.get('/legacy', legacyHandler); // still served by Express for routes Benzene doesn't own
 * ```
 *
 * Fallback mechanism: before doing anything, the middleware asks the {@link IRouteFinder} whether any
 * registered route matches the request's method + path. If not, it calls Express `next()` immediately
 * WITHOUT reading the request body, so downstream middleware (body parsers, other routes) see an untouched
 * request. This mirrors `Benzene.AspNet.Core`'s `if (!context.Response.HasStarted) next()`, using the
 * route table as the explicit "can Benzene handle this?" signal.
 *
 * Body handling: for a matched route the raw request body is read up front (from a body parser's `req.body`
 * if one ran, otherwise from the request stream), mirroring ASP.NET's `UseBufferedRequestBody`. Mount this
 * middleware BEFORE any body parser to let it read the raw body directly; if a JSON parser ran first, the
 * parsed body is re-serialized as a best-effort fallback.
 */
export function benzene(
  configure: PipelineBuilderAction<ExpressContext>,
  options: BenzeneExpressOptions = {},
): BenzeneExpressMiddleware {
  const container = options.container ?? new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addExpress(container);

  const pipelineBuilder = new MiddlewarePipelineBuilder<ExpressContext>(container);
  configure(pipelineBuilder);
  const pipeline = pipelineBuilder.build();

  const factory = container.createServiceResolverFactory();
  const application = new MiddlewareApplication<ExpressContext, ExpressContext>(pipeline, (context) => context);

  // Routes are discovered once at RouteFinder construction and stay stable for the app's lifetime, so
  // resolve the finder a single time rather than per request.
  const routeScope = factory.createScope();
  const routeFinder = routeScope.getService(IRouteFinder);
  routeScope.dispose();

  return (req, res, next) => {
    const method = (req.method ?? 'GET').toUpperCase();
    const path = req.path ?? new URL(req.url ?? '/', 'http://localhost').pathname;

    if (routeFinder.find(method, path) === undefined) {
      next(); // strangler fallback: Benzene owns no route here, hand back to Express untouched
      return;
    }

    readRawBody(req)
      .then((rawBody) => application.handleAsync(new ExpressContext(req, res, rawBody), factory))
      .catch((err: unknown) => next(err));
  };
}

/**
 * Reads the raw request body string. Prefers a body parser's already-parsed `req.body` (re-serializing a
 * parsed JSON object as a best-effort fallback); otherwise consumes the request stream directly. Only
 * called for a matched route, so consuming the stream is safe (an unmatched request already fell through).
 */
async function readRawBody(req: ExpressRequestLike): Promise<string> {
  if (typeof req.body === 'string') {
    return req.body;
  }
  if (req.body !== undefined && req.body !== null) {
    return JSON.stringify(req.body);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}
