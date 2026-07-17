import { Constructor, ServiceIdentifier, VoidResult } from '@benzene/abstractions';
import {
  IHandlerPipelineBuilder,
  IMessageHandlerDefinition,
  IMessageRouterBuilder,
  IMessageTopicGetter,
} from '@benzene/abstractions-message-handlers';
import { IMiddleware, IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { Topic } from '@benzene/core-messages';
import { tryAddScoped } from '@benzene/abstractions';
import { addMessageHandlers } from './DI/Extensions';
import { MessageHandlerDefinition } from './MessageHandlerDefinition';
import { MessageRouter } from './MessageRouter';
import { MessageRouterBuilder } from './MessageRouterBuilder';
import { PresetTopicHolder } from './PresetTopicHolder';
import { PresetTopicMiddleware } from './PresetTopicMiddleware';

/**
 * Pipeline-builder and topic-check free functions for wiring up message-handler dispatch.
 * Port of Benzene.Core.MessageHandlers.Extensions and
 * Benzene.Core.MessageHandlers.MiddlewarePipelineExtensions (C# extension methods become free
 * functions taking the builder/getter as the first argument).
 */

/**
 * Checks whether the message extracted from `context` is for the given topic.
 * Port of C# `Extensions.Is<TContext>` (a non-fluent extension → free function).
 */
export function is<TContext>(
  source: IMessageTopicGetter<TContext>,
  context: TContext,
  topic: string,
  isCaseSensitive = false,
): boolean {
  const contextTopic = source.getTopic(context);
  if (contextTopic === undefined) {
    return false;
  }

  return isCaseSensitive
    ? contextTopic.id === topic
    : contextTopic.id.toLowerCase() === topic.toLowerCase();
}

/**
 * Adds message-handler dispatch to the pipeline. With handler classes supplied, discovery is limited
 * to those; with none supplied, discovery uses the global `MessageHandlersRegistry` (the registry is
 * the port's equivalent of C#'s assembly scanning — see `addMessageHandlers`).
 * Port of C# `MiddlewarePipelineExtensions.UseMessageHandlers` (the `Type[]`/no-arg overloads).
 *
 * C# `app.Use<TContext, MessageRouter<TContext>>()` (resolve the router from DI and add it as the
 * terminal middleware) maps to `app.useService(MessageRouter)`.
 */
export function useMessageHandlers<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  ...handlerTypes: Constructor<unknown>[]
): IMiddlewarePipelineBuilder<TContext> {
  app.register((container) => addMessageHandlers(container, ...handlerTypes));
  return app.useService(MessageRouter as unknown as ServiceIdentifier<IMiddleware<TContext>>);
}

/**
 * Adds message-handler dispatch to the pipeline and lets the caller configure the
 * `MessageRouterBuilder` (e.g. add handler middleware/filters) before the pipeline is built.
 * Port of C# `UseMessageHandlers(Type[] types, Action<MessageRouterBuilder> router)`.
 *
 * The C# router overloads are indistinguishable from the plain overloads at JavaScript runtime (both
 * take a delegate-or-vararg), so per the porting convention they split by name: the router variant is
 * `useMessageHandlersWithRouter`.
 */
export function useMessageHandlersWithRouter<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  router: (builder: MessageRouterBuilder) => void,
  ...handlerTypes: Constructor<unknown>[]
): IMiddlewarePipelineBuilder<TContext> {
  app.register((container) => addMessageHandlers(container, ...handlerTypes));
  const builder = new MessageRouterBuilder([], (action) => app.register(action));
  router(builder);

  return app.use((resolver) => {
    const routePipelineBuilder = resolver.getService(IHandlerPipelineBuilder);
    routePipelineBuilder.add(...builder.getBuilders());
    return resolver.getService(
      MessageRouter as unknown as ServiceIdentifier<IMiddleware<TContext>>,
    );
  });
}

/**
 * Sets a fixed topic on every message that flows through this pipeline, via
 * `PresetTopicMiddleware<TContext>`, so `useMessageHandlers` routes on it regardless of what the
 * underlying transport message itself carries.
 * Port of C# `UsePresetTopic`.
 *
 * As in C#, this resolves `PresetTopicHolder` from the container but does not register it: the
 * transport adapter that opts into preset topics (e.g. SQS/ServiceBus) registers `PresetTopicHolder`
 * scoped and wraps its real topic getter with `PresetTopicMessageTopicGetter`.
 */
export function usePresetTopic<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  topicId: string,
  version = '',
): IMiddlewarePipelineBuilder<TContext> {
  const presetTopic = new Topic(topicId, version);
  return app.use(
    (resolver) =>
      new PresetTopicMiddleware<TContext>(resolver.getService(PresetTopicHolder), presetTopic),
  );
}

/**
 * Registers a request/response handler explicitly, without relying on decorator/registry discovery.
 * Port of C# `MiddlewarePipelineExtensions.AddMessageHandler` (both the response and no-response
 * overloads; the erased generic request/response types become explicit runtime identifiers, and the
 * no-response case is expressed by leaving `responseType` at its `VoidResult` default — the port of
 * C# `typeof(Void)`).
 */
export function addMessageHandler(
  builder: IMessageRouterBuilder,
  handlerType: Constructor<unknown>,
  topic: string,
  requestType: ServiceIdentifier<unknown>,
  responseType: ServiceIdentifier<unknown> = VoidResult,
  version?: string,
): void {
  builder.register((container) => {
    tryAddScoped(container, handlerType);
    container.addSingletonInstance(
      IMessageHandlerDefinition,
      MessageHandlerDefinition.createInstance(
        topic,
        version ?? '',
        requestType,
        responseType,
        handlerType,
      ),
    );
  });
}
