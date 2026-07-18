import { HttpTopicRoute } from './HttpTopicRoute';
import { IHttpEndpointDefinition } from './IHttpEndpointDefinition';
import { IHttpEndpointFinder } from './IHttpEndpointFinder';
import { IRouteFinder } from './IRouteFinder';
import { UrlMatcher } from './UrlMatcher';

/**
 * The default `IRouteFinder`: discovers endpoints once (at construction) via an
 * `IHttpEndpointFinder`, then matches requests by case-insensitive method + `UrlMatcher` path match.
 * Port of Benzene.Http.Routing.RouteFinder.
 */
export class RouteFinder implements IRouteFinder {
  private readonly routes: IHttpEndpointDefinition[];
  private readonly urlMatcher = new UrlMatcher();

  constructor(httpEndpointFinder: IHttpEndpointFinder) {
    this.routes = httpEndpointFinder.findDefinitions();
  }

  find(method: string, path: string): HttpTopicRoute | undefined {
    const lowerMethod = method.toLowerCase();
    for (const route of this.routes) {
      if (route.method.toLowerCase() !== lowerMethod) {
        continue;
      }

      const parameters = this.urlMatcher.matchUrl(path, route.path);

      if (parameters !== undefined) {
        return new HttpTopicRoute(route.topic, parameters);
      }
    }

    return undefined;
  }
}
