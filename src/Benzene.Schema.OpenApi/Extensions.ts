/** Port of Benzene.Schema.OpenApi.Extensions (the UseSpec half). */
import { tryAddSingletonFactory } from '@benzenejs/abstractions';
import { IMessageHandlerDefinition } from '@benzenejs/abstractions-message-handlers';
import { Capability, IMiddlewarePipelineBuilder, capability } from '@benzenejs/abstractions-middleware';
import { MessageHandlerDefinition } from '@benzenejs/core-message-handlers';
import { RawStringMessage } from '@benzenejs/core-messages';
import { AsyncApiSpecOptions } from './AsyncApi/AsyncApiSpecOptions';
import { Constants } from './Constants';
import { SpecCache } from './SpecCache';
import { SpecMessageHandler } from './SpecMessageHandler';
import { SpecRequest } from './SpecRequest';

/**
 * Registers the `benzene:spec` handler, which serves the service's benzene spec document (topics + payload JSON
 * Schemas + `components.schemas`) on the reserved `benzene:spec` topic. Opt-in, like the C# `UseSpec`: nothing is
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

/**
 * Overrides the suffix used to name a handled topic's reply channel in the generated AsyncAPI document
 * (default `response`, i.e. `<topic>:response`). For example, passing `"reply"` makes a handler on
 * `shipping:get-all` reply on `shipping:get-all:reply`. Port of the C# `SetAsyncApiResponseTopicSuffix`
 * container extension, taking the pipeline builder first (as `useSpec` does).
 */
export function setAsyncApiResponseTopicSuffix<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  responseTopicSuffix: string,
): IMiddlewarePipelineBuilder<TContext> {
  app.register((container) => {
    const options = new AsyncApiSpecOptions();
    options.responseTopicSuffix = responseTopicSuffix;
    container.addSingletonInstance(AsyncApiSpecOptions, options);
  });
  return app;
}
