import { IHttpEndpointDefinition } from './IHttpEndpointDefinition';

/**
 * Concrete `IHttpEndpointDefinition` pairing an HTTP method + path pattern with a message topic.
 * Port of Benzene.Http.Routing.HttpEndpointDefinition.
 */
export class HttpEndpointDefinition implements IHttpEndpointDefinition {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly topic: string,
  ) {}

  /** Port of C# `CreateInstance`. */
  static createInstance(method: string, path: string, topic: string): IHttpEndpointDefinition {
    return new HttpEndpointDefinition(method, path, topic);
  }
}
