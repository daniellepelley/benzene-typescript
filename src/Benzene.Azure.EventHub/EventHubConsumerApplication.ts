/** Port of Benzene.Azure.EventHub.EventHubConsumerApplication. */
import { ReceivedEventData } from '@azure/event-hubs';
import { IMessageResult, TransportNames } from '@benzenejs/abstractions-message-handlers';
import { IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { TransportMiddlewarePipeline } from '@benzenejs/core-message-handlers';
import { MiddlewareApplicationWithResult } from '@benzenejs/core-middleware';
import { EventHubConsumerContext } from './EventHubConsumerContext';

/**
 * Processes a single received event by mapping it to an {@link EventHubConsumerContext} and running it
 * through the middleware pipeline in its own service scope, tagging the transport as `"event-hub"` for
 * the duration. Returns the handler's recorded result (or `undefined` if nothing set one), which the
 * worker reads for the `raiseOnFailureStatus` escalation.
 *
 * Uses the ported `MiddlewareApplicationWithResult` base (C# `MiddlewareApplication<TEvent, TContext,
 * IBenzeneResult?>`), wrapping the pipeline in `TransportMiddlewarePipeline("event-hub")`.
 */
export class EventHubConsumerApplication extends MiddlewareApplicationWithResult<
  ReceivedEventData,
  EventHubConsumerContext,
  IMessageResult | undefined
> {
  constructor(pipeline: IMiddlewarePipeline<EventHubConsumerContext>) {
    super(
      new TransportMiddlewarePipeline<EventHubConsumerContext>(TransportNames.EventHub, pipeline),
      EventHubConsumerContext.createInstance,
      (context) => context.messageResult,
    );
  }
}
