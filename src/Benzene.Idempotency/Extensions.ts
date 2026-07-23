import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { IMessageBodyGetter, IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { HeaderOrBodyHashIdempotencyKeyStrategy } from './HeaderOrBodyHashIdempotencyKeyStrategy';
import { IIdempotencyKeyStrategy } from './IIdempotencyKeyStrategy';
import { IIdempotencyStore } from './IIdempotencyStore';
import { IdempotencyMiddleware } from './IdempotencyMiddleware';
import { IdempotencyOptions } from './IdempotencyOptions';
import { InMemoryIdempotencyStore } from './InMemoryIdempotencyStore';

/**
 * Adds idempotency de-duplication to the pipeline. Requires an {@link IIdempotencyStore} to be
 * registered (see {@link addInMemoryIdempotencyStore} or register your own). Uses a custom
 * {@link IIdempotencyKeyStrategy} if one is registered for `TContext`, otherwise the default
 * header/body-hash strategy.
 *
 * Port of Benzene.Idempotency.Extensions.UseIdempotency (a C# extension method -> a free function
 * taking the builder as the first argument, the port-wide convention).
 */
export function useIdempotency<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  configure?: (options: IdempotencyOptions) => void,
): IMiddlewarePipelineBuilder<TContext> {
  const options = new IdempotencyOptions();
  configure?.(options);

  return app.use((resolver) => {
    const keyStrategy =
      (resolver.tryGetService(IIdempotencyKeyStrategy) as unknown as
        | IIdempotencyKeyStrategy<TContext>
        | undefined) ??
      new HeaderOrBodyHashIdempotencyKeyStrategy<TContext>(
        resolver.getService(IMessageHeadersGetter) as unknown as IMessageHeadersGetter<TContext>,
        resolver.getService(IMessageBodyGetter) as unknown as IMessageBodyGetter<TContext>,
        resolver.getService(IMessageTopicGetter) as unknown as IMessageTopicGetter<TContext>,
        options,
      );

    return new IdempotencyMiddleware<TContext>(
      resolver.getService(IIdempotencyStore),
      keyStrategy,
      options,
    );
  });
}

/**
 * Registers the {@link InMemoryIdempotencyStore} as the {@link IIdempotencyStore}. Suitable for a
 * single worker instance, tests, and local development; use a shared store in a multi-instance
 * deployment. Call once at application setup.
 *
 * @param timeToLiveMs How long records are retained, in milliseconds. Defaults to 24 hours.
 */
export function addInMemoryIdempotencyStore(
  services: IBenzeneServiceContainer,
  timeToLiveMs?: number,
): IBenzeneServiceContainer {
  services.addSingletonInstance(IIdempotencyStore, new InMemoryIdempotencyStore(timeToLiveMs));
  return services;
}
