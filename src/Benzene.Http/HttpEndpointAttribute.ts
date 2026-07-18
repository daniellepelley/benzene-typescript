import { Constructor } from '@benzene/abstractions';

/**
 * Marks a message-handler class as an HTTP endpoint (method + URL pattern), the routing counterpart
 * of `@message`.
 * Port of Benzene.Http.HttpEndpointAttribute.
 *
 * The C# `[HttpEndpoint("GET", "/users/{id}")]` attribute (`AllowMultiple = true`) becomes the
 * `@httpEndpoint('GET', '/users/{id}')` class decorator, applied per the port's "attribute ->
 * decorator + metadata store" convention (same shape as `@message`). Because .NET reflection reads
 * the attribute and JavaScript erases it, the decorator records the metadata itself in a per-class
 * store; `RegistryHttpEndpointFinder` reads it. Being repeatable, the metadata is an array — each
 * application appends one endpoint. Also usable as a plain function: `httpEndpoint('GET', '/x')(MyHandler)`.
 */
export interface HttpEndpointMetadata {
  readonly method: string;
  readonly url: string;
}

const metadataStore = new WeakMap<Constructor<unknown>, HttpEndpointMetadata[]>();

export function httpEndpoint(
  method: string,
  url: string,
): <T extends Constructor<unknown>>(target: T, context?: ClassDecoratorContext) => T {
  return (target) => {
    const existing = metadataStore.get(target) ?? [];
    existing.push({ method, url });
    metadataStore.set(target, existing);
    return target;
  };
}

/** Reads the endpoint metadata recorded by the `httpEndpoint` decorator, if any. */
export function getHttpEndpointMetadata(
  handlerType: Constructor<unknown>,
): HttpEndpointMetadata[] | undefined {
  return metadataStore.get(handlerType);
}
