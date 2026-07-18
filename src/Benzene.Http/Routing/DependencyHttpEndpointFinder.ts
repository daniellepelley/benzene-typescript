import { IHttpEndpointDefinition } from './IHttpEndpointDefinition';
import { IHttpEndpointFinder } from './IHttpEndpointFinder';

/**
 * Discovers HTTP endpoints registered directly in the DI container (the port of C#
 * `IEnumerable<IHttpEndpointDefinition>` constructor injection — resolved via
 * `resolver.getServices(IHttpEndpointDefinition)`).
 * Port of Benzene.Http.Routing.DependencyHttpEndpointFinder.
 */
export class DependencyHttpEndpointFinder implements IHttpEndpointFinder {
  private readonly httpEndpointDefinitions: IHttpEndpointDefinition[];

  constructor(httpEndpointDefinitions: Iterable<IHttpEndpointDefinition>) {
    this.httpEndpointDefinitions = [...httpEndpointDefinitions];
  }

  findDefinitions(): IHttpEndpointDefinition[] {
    return [...this.httpEndpointDefinitions];
  }
}
