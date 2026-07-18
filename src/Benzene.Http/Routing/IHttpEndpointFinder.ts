import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { IHttpEndpointDefinition } from './IHttpEndpointDefinition';

/**
 * Discovers HTTP endpoint definitions (via decorators, DI registration, manual lists, ...).
 * Port of Benzene.Http.Routing.IHttpEndpointFinder.
 */
export interface IHttpEndpointFinder {
  /** Returns all HTTP endpoint definitions this finder knows about. Port of C# `FindDefinitions`. */
  findDefinitions(): IHttpEndpointDefinition[];
}

export const IHttpEndpointFinder: ServiceToken<IHttpEndpointFinder> =
  serviceToken<IHttpEndpointFinder>('IHttpEndpointFinder');
