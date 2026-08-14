/**
 * Minimal structural types for the Express/Connect request, response, and `next` a Benzene middleware
 * touches. Declaring them here (rather than importing `express`) keeps `@benzenejs/express` free of a
 * runtime dependency on Express - the produced middleware is a standard `(req, res, next)` function that
 * works with Express or any Connect-style host. `express`/`@types/express` are only needed by the
 * consuming app; a real Express `Request`/`Response` structurally satisfies these.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * The request half. Extends Node's `IncomingMessage` (Express's `Request` does too) and adds the two
 * Express-populated members Benzene may read: `path` (route path without query) and `body` (present when
 * a body parser ran before Benzene - see the middleware's raw-body handling).
 */
export interface ExpressRequestLike extends IncomingMessage {
  /** Express's parsed path (without query string). Falls back to the URL's pathname when absent. */
  path?: string;
  /** A body parser's parsed body, if one ran before Benzene. */
  body?: unknown;
}

/** The response half - Node's `ServerResponse` (Express's `Response` extends it). */
export type ExpressResponseLike = ServerResponse;

/** Express's `next` callback: continue the pipeline, or forward an error to error-handling middleware. */
export type ExpressNextFunction = (err?: unknown) => void;

/** A standard Express/Connect middleware function. */
export type BenzeneExpressMiddleware = (
  req: ExpressRequestLike,
  res: ExpressResponseLike,
  next: ExpressNextFunction,
) => void;
