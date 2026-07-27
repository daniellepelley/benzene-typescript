/** Port of Benzene.Schema.OpenApi.Extensions (the UseSpec half). */
import { tryAddSingletonFactory } from '@benzene/abstractions';
import { IMessageHandlerDefinition } from '@benzene/abstractions-message-handlers';
import { Capability, IMiddlewarePipelineBuilder, capability } from '@benzene/abstractions-middleware';
import { MessageHandlerDefinition } from '@benzene/core-message-handlers';
import { RawStringMessage } from '@benzene/core-messages';
import { Constants } from './Constants';
import { SpecCache } from './SpecCache';
import { SpecMessageHandler } from './SpecMessageHandler';
import { SpecRequest } from './SpecRequest';

/**
 * Registers the `spec` handler, which serves the service's benzene spec document (topics + payload JSON
 * Schemas + `components.schemas`) on the reserved `spec` topic. Opt-in, like the C# `UseSpec`: nothing is
 * exposed unless called. C# extension method → free function taking the pipeline builder first.
 *
 * The handler is DI-registered (definition + scoped factory), so it's dispatched by the message-handler
 * pipeline's dependency finder alongside the app's own handlers. `SpecCache` memoizes the built document.
 */
export function useSpec<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  topic: string = Constants.DefaultSpecTopic,
): IMiddlewarePipelineBuilder<TContext> {
  app.register((container) => {
    container.addSingletonInstance(
      IMessageHandlerDefinition,
      MessageHandlerDefinition.createInstance(topic, '', SpecRequest, RawStringMessage, SpecMessageHandler),
    );
    container.addScopedFactory(SpecMessageHandler, (resolver) => new SpecMessageHandler(resolver));
    // TryAdd so a second useSpec call (or a host that pre-registers a cache) is a no-op.
    tryAddSingletonFactory(container, SpecCache, () => new SpecCache());
  });
  return app;
}

/**
 * The `spec` endpoint as a {@link Capability}: `builder.use(spec())` (the .NET `UseSpec()` shape).
 */
export function spec<TContext>(topic: string = Constants.DefaultSpecTopic): Capability<TContext> {
  return capability<TContext>((builder) => useSpec(builder, topic));
}
