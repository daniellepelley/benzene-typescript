/**
 * Derives this service's benzene `spec` descriptor from its handler registry - the same JSON a .NET Benzene
 * service's spec endpoint serves, so a mesh aggregator (in any language) can interrogate it. The topics and
 * their HTTP mappings come straight from the `@message`/`@httpEndpoint` metadata the handlers declared, so
 * the descriptor is a projection of the running code, never hand-maintained.
 *
 * Note: request/response JSON *schemas* aren't included here - deriving them would need the normative
 * `ServiceDescriptor` path (schemas from a `@benzene/zod`/`joi`/`yup` registry; see the README's
 * "Multi-language interoperability" section). The aggregator handles a schema-less descriptor fine: it still
 * builds the cross-service topic catalog and topology from the topics themselves.
 */
import { MessageHandlersRegistry, RegistryMessageHandlersFinder } from '@benzene/core-message-handlers';
import { RegistryHttpEndpointFinder } from '@benzene/http';

interface SpecRequest {
  topic: string;
  version?: string;
  httpMappings?: { method: string; path: string }[];
}

/** Builds the `{ requests, events, transports }` benzene descriptor JSON from the registry. */
export function buildBenzeneSpec(registry: MessageHandlersRegistry): string {
  const handlersFinder = new RegistryMessageHandlersFinder(registry);
  const endpoints = new RegistryHttpEndpointFinder(handlersFinder).findDefinitions();

  const requests: SpecRequest[] = handlersFinder.findDefinitions().map((definition) => {
    const httpMappings = endpoints
      .filter((endpoint) => endpoint.topic === definition.topic.id)
      .map((endpoint) => ({ method: endpoint.method.toLowerCase(), path: endpoint.path }));

    const request: SpecRequest = { topic: definition.topic.id };
    if (definition.topic.version !== '') {
      request.version = definition.topic.version;
    }
    if (httpMappings.length > 0) {
      request.httpMappings = httpMappings;
    }
    return request;
  });

  return JSON.stringify({ requests, events: [], transports: ['http'] }, null, 2);
}
