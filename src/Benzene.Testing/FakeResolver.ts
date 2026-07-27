/**
 * Test helpers that retire the two most common sources of ceremony in Benzene middleware unit tests: a
 * hand-rolled `IServiceResolver` object literal, and a hand-forged message context with a
 * `response: undefined as unknown as IBenzeneResultOf<T>` hole.
 */
import { IServiceResolver, ServiceIdentifier, serviceIdentifierName } from '@benzene/abstractions';
import { MessageHandlerContext } from '@benzene/core-message-handlers';
import { Topic } from '@benzene/core-messages';

/**
 * Builds a minimal in-memory `IServiceResolver` from `[identifier, implementation]` pairs — no object
 * literal, no `as unknown as` casts. A `Map` is itself an iterable of pairs, so `fakeResolver(new
 * Map([[IThing, impl]]))` and `fakeResolver([[IThing, impl]])` both work.
 *
 * `getService` throws for an unregistered identifier (like the real resolver); `tryGetService` returns
 * `undefined`; `getServices` returns the single registration (or none). `dispose`/`disposeAsync` are no-ops.
 */
export function fakeResolver(
  entries: Iterable<readonly [ServiceIdentifier<unknown>, unknown]>,
): IServiceResolver {
  const map = new Map<unknown, unknown>(entries as Iterable<readonly [unknown, unknown]>);
  return {
    getService<T>(identifier: ServiceIdentifier<T>): T {
      if (!map.has(identifier)) {
        throw new Error(`fakeResolver: no registration for ${serviceIdentifierName(identifier)}`);
      }
      return map.get(identifier) as T;
    },
    tryGetService<T>(identifier: ServiceIdentifier<T>): T | undefined {
      return map.get(identifier) as T | undefined;
    },
    getServices<T>(identifier: ServiceIdentifier<T>): T[] {
      return map.has(identifier) ? [map.get(identifier) as T] : [];
    },
    dispose(): void {
      /* nothing to dispose */
    },
    disposeAsync(): Promise<void> {
      return Promise.resolve();
    },
  };
}

/**
 * Builds a real {@link MessageHandlerContext} for driving one middleware directly — its constructor
 * seeds a valid default `response`, so a test never forges `response: undefined as unknown as
 * IBenzeneResultOf<T>`. The middleware under test overwrites `context.response` as it runs.
 */
export function messageContext<TRequest, TResponse>(
  topic: string,
  request: TRequest,
): MessageHandlerContext<TRequest, TResponse> {
  return new MessageHandlerContext<TRequest, TResponse>(new Topic(topic), request);
}
