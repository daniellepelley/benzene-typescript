/** Port of Benzene.Azure.Function.EventHub.Function.Extensions. */
import { ReceivedEventData } from '@azure/event-hubs';
import { IMiddlewarePipelineBuilder, PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { IAzureFunctionApp } from '@benzene/azure-function-core';
import { BenzeneMessageContext } from '@benzene/core-messages';
import { addBenzeneMessage } from '@benzene/core-message-handlers';
import { BenzeneMessageEventHubHandler } from './BenzeneMessageEventHubHandler';
import { EventHubContext } from './EventHubContext';

/**
 * Adds direct Benzene message handling to an Event Hub pipeline. Port of C#
 * `Extensions.UseBenzeneMessage`, which has two overloads (co-located here as one function with
 * TypeScript overload signatures, discriminated at runtime because a builder is an object and an action
 * is a function):
 *
 *  - configuring the inner direct-message pipeline INLINE via an `action` — this registers the
 *    `BenzeneMessage` services (`addBenzeneMessage`), builds a nested `BenzeneMessageContext` pipeline
 *    from `action`, and appends a `BenzeneMessageEventHubHandler` over it. (C# `app.Register(x =>
 *    x.AddBenzeneMessage())` + `app.Create<BenzeneMessageContext>()` + `app.Use(...)`.)
 *  - reusing an ALREADY-BUILT inner pipeline builder — this just builds it and appends the handler,
 *    without re-registering the services (faithful to C#, whose builder overload does not call
 *    `AddBenzeneMessage`).
 *
 * @param app The Event Hub pipeline builder to add message handling to.
 * @param actionOrBuilder Either an action configuring the inner direct-message pipeline, or an
 *   already-configured inner `BenzeneMessageContext` pipeline builder.
 */
export function useBenzeneMessage(
  app: IMiddlewarePipelineBuilder<EventHubContext>,
  action: PipelineBuilderAction<BenzeneMessageContext>,
): IMiddlewarePipelineBuilder<EventHubContext>;
export function useBenzeneMessage(
  app: IMiddlewarePipelineBuilder<EventHubContext>,
  builder: IMiddlewarePipelineBuilder<BenzeneMessageContext>,
): IMiddlewarePipelineBuilder<EventHubContext>;
export function useBenzeneMessage(
  app: IMiddlewarePipelineBuilder<EventHubContext>,
  actionOrBuilder:
    | PipelineBuilderAction<BenzeneMessageContext>
    | IMiddlewarePipelineBuilder<BenzeneMessageContext>,
): IMiddlewarePipelineBuilder<EventHubContext> {
  if (typeof actionOrBuilder === 'function') {
    app.register((x) => addBenzeneMessage(x));
    const middlewarePipelineBuilder = app.create<BenzeneMessageContext>();
    actionOrBuilder(middlewarePipelineBuilder);
    const pipeline = middlewarePipelineBuilder.build();
    return app.use((resolver) => new BenzeneMessageEventHubHandler(pipeline, resolver));
  }

  const pipeline = actionOrBuilder.build();
  return app.use((resolver) => new BenzeneMessageEventHubHandler(pipeline, resolver));
}

/**
 * Dispatches Event Hub event data to the Azure Function app's Event Hub entry point application. Port of
 * C# `Extensions.HandleEventHub(this IAzureFunctionApp, params EventData[])`. C# `params` maps to a
 * TypeScript rest parameter; the batch type is the Node received type `ReceivedEventData[]`.
 *
 * @param source The built Azure Function app to dispatch to.
 * @param eventData The Event Hub events to handle.
 */
export function handleEventHub(
  source: IAzureFunctionApp,
  ...eventData: ReceivedEventData[]
): Promise<void> {
  return source.handleAsync(eventData);
}
