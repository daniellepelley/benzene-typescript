/** Port of Benzene.Aws.Lambda.EventBridge.EventBridgeApplication. */
import { IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { MiddlewareApplication } from '@benzenejs/core-middleware';
import { TransportMiddlewarePipeline, TransportNames } from '@benzenejs/core-message-handlers';
import { EventBridgeEvent } from 'aws-lambda';
import { EventBridgeContext } from './EventBridgeContext';

/**
 * Runs one EventBridge event through the `EventBridgeContext` middleware pipeline — a SINGLE-context
 * application (one pipeline invocation + one DI scope per event), since EventBridge invokes a Lambda target
 * with exactly one event, not a batch.
 *
 * Faithful to .NET: C# `EventBridgeApplication : MiddlewareApplication<EventBridgeEvent, EventBridgeContext>`
 * maps to the ported `MiddlewareApplication<EventBridgeEvent<string, unknown>, EventBridgeContext>` (NOT a
 * `MiddlewareMultiApplication` fan-out — there is no `Records` batch). The base constructor takes the
 * `TransportMiddlewarePipeline("eventbridge", pipeline)` wrapper and a mapper from the event to its single
 * context.
 */
export class EventBridgeApplication extends MiddlewareApplication<
  EventBridgeEvent<string, unknown>,
  EventBridgeContext
> {
  constructor(pipeline: IMiddlewarePipeline<EventBridgeContext>) {
    super(
      new TransportMiddlewarePipeline<EventBridgeContext>(TransportNames.EventBridge, pipeline),
      (event) => new EventBridgeContext(event),
    );
  }
}
