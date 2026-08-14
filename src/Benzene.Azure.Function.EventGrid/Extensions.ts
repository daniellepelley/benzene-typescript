/** Port of Benzene.Azure.Function.EventGrid.Extensions. */
import { IAzureFunctionApp } from '@benzenejs/azure-function-core';
import { EventGridTriggerEvent } from './EventGridTriggerEvent';

/**
 * Dispatches Event Grid events to the Azure Function app's Event Grid entry point application. Port of
 * C# `Extensions.HandleEventGridEvents(this IAzureFunctionApp, params EventGridTriggerEvent[])`. The
 * trigger delivers one event per invocation by default; the rest-parameter shape (C# `params`) covers
 * batched delivery and tests.
 *
 * DEFERRED: the C# `name`-keyed `HandleEventGridEvents(source, name, ...events)` overload is not ported
 * — the ported `IAzureFunctionApp` has no name-keyed dispatch (same as the QueueStorage/ServiceBus
 * ports).
 *
 * @param source The built Azure Function app to dispatch to.
 * @param events The events to handle.
 */
export function handleEventGridEvents(
  source: IAzureFunctionApp,
  ...events: EventGridTriggerEvent[]
): Promise<void> {
  return source.handleAsync(events);
}

/**
 * Dispatches a raw Event Grid delivery — the `[EventGridTrigger] string` binding — to the Azure Function
 * app's Event Grid entry point application, parsing either the Event Grid schema or CloudEvents 1.0 (see
 * `EventGridTriggerEvent.parse`). Port of C# `Extensions.HandleEventGridEvent(this IAzureFunctionApp,
 * string)`.
 *
 * @param source The built Azure Function app to dispatch to.
 * @param eventJson The event JSON as delivered to the trigger.
 */
export function handleEventGridEvent(source: IAzureFunctionApp, eventJson: string): Promise<void> {
  return handleEventGridEvents(source, EventGridTriggerEvent.parse(eventJson));
}
