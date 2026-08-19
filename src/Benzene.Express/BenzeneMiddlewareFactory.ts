import { IServiceResolverFactory } from '@benzenejs/abstractions';
import { IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { MiddlewareApplication } from '@benzenejs/core-middleware';
import { IRouteFinder } from '@benzenejs/http';
import { ExpressContext } from './ExpressContext';
import { BenzeneExpressMiddleware, ExpressRequestLike } from './types';

/**
 * The request half of {@link benzene}, over an already-built pipeline and resolver factory. Shared with
 * {@link useExpress}, whose worker is the same middleware behind a `node:http` server it owns itself.
 * Package-internal: not re-exported from the package index.
 */
export function middlewareFor(
  pipeline: IMiddlewarePipeline<ExpressContext>,
  factory: IServiceResolverFactory,
): BenzeneExpressMiddleware {
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
