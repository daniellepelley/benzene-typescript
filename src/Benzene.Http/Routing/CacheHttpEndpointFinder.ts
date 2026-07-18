import { IHttpEndpointDefinition } from './IHttpEndpointDefinition';
import { IHttpEndpointFinder } from './IHttpEndpointFinder';

/**
 * Caches an inner `IHttpEndpointFinder`'s results so discovery (which can be expensive) runs once.
 * Port of Benzene.Http.Routing.CacheHttpEndpointFinder.
 */
export class CacheHttpEndpointFinder implements IHttpEndpointFinder {
  private httpEndpointDefinitions?: IHttpEndpointDefinition[];

  constructor(private readonly inner: IHttpEndpointFinder) {}

  findDefinitions(): IHttpEndpointDefinition[] {
    return (this.httpEndpointDefinitions ??= this.inner.findDefinitions());
  }
}
