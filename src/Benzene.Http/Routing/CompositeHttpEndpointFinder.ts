import { IHttpEndpointDefinition } from './IHttpEndpointDefinition';
import { IHttpEndpointFinder } from './IHttpEndpointFinder';

/**
 * Combines multiple `IHttpEndpointFinder`s, aggregating their discovered endpoints.
 * Port of Benzene.Http.Routing.CompositeHttpEndpointFinder.
 */
export class CompositeHttpEndpointFinder implements IHttpEndpointFinder {
  private readonly inners: IHttpEndpointFinder[];

  constructor(...inners: IHttpEndpointFinder[]) {
    this.inners = inners;
  }

  findDefinitions(): IHttpEndpointDefinition[] {
    return this.inners.flatMap((x) => x.findDefinitions());
  }
}
