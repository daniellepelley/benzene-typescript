import { BenzeneException } from '@benzene/core';
import { IMessageHandlersFinder } from '@benzene/abstractions-message-handlers';
import { getHttpEndpointMetadata } from '../HttpEndpointAttribute';
import { HttpEndpointDefinition } from './HttpEndpointDefinition';
import { IHttpEndpointDefinition } from './IHttpEndpointDefinition';
import { IHttpEndpointFinder } from './IHttpEndpointFinder';

/**
 * Discovers HTTP endpoints by reading each message handler's `@httpEndpoint` metadata, pairing every
 * declared endpoint with that handler's `@message` topic.
 * Port of Benzene.Http.Routing.ReflectionHttpEndpointFinder — the C# reflection scan over handler
 * classes' `HttpEndpointAttribute`s maps to the decorator metadata store (per the README "Handler
 * discovery: reflection -> registry/decorator" convention), correlated with the handler's topic via
 * the same `IMessageHandlersFinder` the C# original uses. The duplicate-route validation is preserved.
 */
export class RegistryHttpEndpointFinder implements IHttpEndpointFinder {
  constructor(private readonly messageHandlersFinder: IMessageHandlersFinder) {}

  findDefinitions(): IHttpEndpointDefinition[] {
    const handlers = this.messageHandlersFinder
      .findDefinitions()
      .flatMap((definition) =>
        (getHttpEndpointMetadata(definition.handlerType) ?? []).map(
          (endpoint) =>
            new HttpEndpointDefinition(endpoint.method, endpoint.url, definition.topic.id),
        ),
      );

    const seen = new Map<string, number>();
    for (const handler of handlers) {
      const key = `${handler.method} - ${handler.path}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }

    const duplicate = [...seen.entries()].find(([, count]) => count > 1);
    if (duplicate !== undefined) {
      throw new BenzeneException(
        `Route '${duplicate[0]}' has been assigned to more than one message handler, this is not permitted`,
      );
    }

    return handlers;
  }
}
