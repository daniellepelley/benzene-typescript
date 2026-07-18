import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { IHttpEndpointDefinition } from './IHttpEndpointDefinition';

/**
 * Allows manual registration of HTTP endpoint definitions into a list-based finder.
 * Port of Benzene.Http.Routing.IListHttpEndpointFinder.
 */
export interface IListHttpEndpointFinder {
  /** Adds an endpoint definition to the finder's list. Port of C# `Add`. */
  add(httpEndpointDefinition: IHttpEndpointDefinition): void;
}

export const IListHttpEndpointFinder: ServiceToken<IListHttpEndpointFinder> =
  serviceToken<IListHttpEndpointFinder>('IListHttpEndpointFinder');
