import { describe, expect, it } from 'vitest';
import {
  IBenzeneResultOf,
  IDependencyWrapper,
  IServiceResolver,
} from '@benzene/abstractions';
import { IBenzeneClientRequest } from '@benzene/abstractions-messages';
import { BenzeneResult } from '@benzene/results';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import {
  BenzeneClientRequest,
  ClientBuilder,
  DependencyWrapperFactory,
  IBenzeneMessageClient,
} from '@benzene/clients';

/**
 * Ports the spirit of Benzene.Clients' ClientBuilder/DependencyWrapperFactory usage: a base
 * `IBenzeneMessageClient` wrapped by two `IDependencyWrapper`s produces a client whose
 * `sendMessageAsync` passes through the decorator chain in order. Verifies the fold direction:
 * first-added wrapper is innermost, last-added is outermost (its `wrap` output runs first on send).
 */

/** Records, in order, the layers a send passed through. */
class RecordingClient implements IBenzeneMessageClient {
  constructor(private readonly order: string[]) {}

  sendMessageAsync<TRequest, TResponse>(
    _request: IBenzeneClientRequest<TRequest>,
  ): Promise<IBenzeneResultOf<TResponse>> {
    this.order.push('base');
    return Promise.resolve(BenzeneResult.ok<TResponse>());
  }

  dispose(): void {}
}

/** A decorator that tags itself onto the order list (and the outgoing headers) then delegates. */
class TaggingClient implements IBenzeneMessageClient {
  constructor(
    private readonly inner: IBenzeneMessageClient,
    private readonly tag: string,
    private readonly order: string[],
  ) {}

  sendMessageAsync<TRequest, TResponse>(
    request: IBenzeneClientRequest<TRequest>,
  ): Promise<IBenzeneResultOf<TResponse>> {
    this.order.push(this.tag);
    return this.inner.sendMessageAsync<TRequest, TResponse>(
      new BenzeneClientRequest<TRequest>(request.topic, request.message, {
        ...request.headers,
        [this.tag]: 'yes',
      }),
    );
  }

  dispose(): void {
    this.inner.dispose();
  }
}

class TaggingWrapper implements IDependencyWrapper<IBenzeneMessageClient> {
  constructor(private readonly tag: string, private readonly order: string[]) {}

  wrap(_serviceResolver: IServiceResolver, client: IBenzeneMessageClient): IBenzeneMessageClient {
    return new TaggingClient(client, this.tag, this.order);
  }
}

describe('ClientBuilderTest', () => {
  it('Build_appliesDependencyWrappers_inChainOrder', async () => {
    const order: string[] = [];
    const resolver = new DefaultBenzeneServiceContainer().createServiceResolverFactory().createScope();

    const builder = new ClientBuilder(() => new RecordingClient(order))
      .withDependencyWrapper(new TaggingWrapper('a', order)) // added first  -> innermost
      .withDependencyWrapper(new TaggingWrapper('b', order)); // added last   -> outermost

    const client = builder.build(resolver);
    await client.sendMessageAsync(new BenzeneClientRequest('topic', {}, {}));
    resolver.dispose();

    // Outermost (last-added 'b') runs first, then 'a', then the base client.
    expect(order).toEqual(['b', 'a', 'base']);
  });

  it('DependencyWrapperFactory_foldsWrappers_leftToRight', () => {
    const order: string[] = [];
    const resolver = new DefaultBenzeneServiceContainer().createServiceResolverFactory().createScope();

    const factory = new DependencyWrapperFactory<IBenzeneMessageClient>([
      new TaggingWrapper('a', order),
      new TaggingWrapper('b', order),
    ]);

    const result = factory.create(resolver, new RecordingClient(order));
    resolver.dispose();

    // 'b' was folded last, so it is the outermost instance returned.
    expect(result).toBeInstanceOf(TaggingClient);
  });
});
