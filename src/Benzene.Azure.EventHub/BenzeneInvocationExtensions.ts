/** Port of Benzene.Azure.EventHub.BenzeneInvocationExtensions. */
import { ServiceIdentifier } from '@benzenejs/abstractions';
import { IMiddlewarePipelineBuilder } from '@benzenejs/abstractions-middleware';
import { BenzeneInvocation, useBenzeneInvocation as coreUseBenzeneInvocation } from '@benzenejs/core-middleware';
import { WorkerApplicationBuilder } from '@benzenejs/self-host';
import { EventHubConsumerContext } from './EventHubConsumerContext';

/**
 * Adds middleware that exposes an `IBenzeneInvocation` for the duration of each event's dispatch, with
 * `invocationId` set to the event's service-assigned `sequenceNumber`. Auto-wired by `useEventHub(...)`
 * as the first middleware in the Event Hub pipeline — a long-running worker has no Functions-style outer
 * "invocation" boundary, so the sequence number is the only invocation identity available here.
 */
export function useBenzeneInvocation(
  app: IMiddlewarePipelineBuilder<EventHubConsumerContext>,
): IMiddlewarePipelineBuilder<EventHubConsumerContext> {
  return coreUseBenzeneInvocation(
    app,
    (_serviceResolver, context) =>
      new BenzeneInvocation(
        String(context.eventData.sequenceNumber),
        WorkerApplicationBuilder.platformName,
        new Map<ServiceIdentifier<unknown>, unknown>(),
      ),
  );
}
