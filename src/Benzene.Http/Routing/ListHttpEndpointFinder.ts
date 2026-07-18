import { IHttpEndpointDefinition } from './IHttpEndpointDefinition';
import { IHttpEndpointFinder } from './IHttpEndpointFinder';
import { IListHttpEndpointFinder } from './IListHttpEndpointFinder';

/**
 * A list-based endpoint finder that allows endpoints to be registered programmatically.
 * Port of Benzene.Http.Routing.ListHttpEndpointFinder.
 */
export class ListHttpEndpointFinder implements IHttpEndpointFinder, IListHttpEndpointFinder {
  private readonly list: IHttpEndpointDefinition[] = [];

  findDefinitions(): IHttpEndpointDefinition[] {
    return [...this.list];
  }

  add(httpEndpointDefinition: IHttpEndpointDefinition): void {
    this.list.push(httpEndpointDefinition);
  }
}
