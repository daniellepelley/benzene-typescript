import { ServiceToken, serviceToken } from '@benzenejs/abstractions';

/**
 * Metadata for an HTTP endpoint — its method, path pattern, and the message topic it routes to.
 * Port of Benzene.Http.Routing.IHttpEndpointDefinition.
 *
 * The interface doubles as its own DI token (`DependencyHttpEndpointFinder` collects every
 * registered `IHttpEndpointDefinition`), mirroring the C# `IEnumerable<IHttpEndpointDefinition>`
 * constructor injection.
 */
export interface IHttpEndpointDefinition {
  /** The HTTP method (GET, POST, ...). */
  readonly method: string;

  /** The URL path pattern, which may include route parameters (e.g. `/users/{id}`). */
  readonly path: string;

  /** The topic/message name that identifies the handler for this endpoint. */
  readonly topic: string;

  /**
   * The handler version this route reaches, when it was declared on a versioned handler (`@httpEndpoint` on
   * a `@message(topic, { version })` class). Absent for a route registered against a bare topic: it reaches
   * whichever handler the request's version selects. Lets the spec attach `httpMappings` to the right
   * `(topic, version)` entry (contract-document.md §2).
   */
  readonly version?: string;
}

export const IHttpEndpointDefinition: ServiceToken<IHttpEndpointDefinition> =
  serviceToken<IHttpEndpointDefinition>('IHttpEndpointDefinition');
