import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { HttpTopicRoute } from './HttpTopicRoute';

/**
 * Finds the HTTP route matching a given method + path.
 * Port of Benzene.Http.Routing.IRouteFinder (C# `HttpTopicRoute?` "no match" -> `undefined`).
 */
export interface IRouteFinder {
  /** Finds the route matching `method` and `path`, or `undefined` if none matches. Port of C# `Find`. */
  find(method: string, path: string): HttpTopicRoute | undefined;
}

export const IRouteFinder: ServiceToken<IRouteFinder> = serviceToken<IRouteFinder>('IRouteFinder');
