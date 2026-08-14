/** Port of Benzene.Azure.Function.EventGrid.EventGridContext. */
import { IHasMessageResult, IMessageResult } from '@benzenejs/abstractions-message-handlers';
import { EventGridTriggerEvent } from './EventGridTriggerEvent';

/**
 * Provides the middleware pipeline context for a single event within an Azure Functions Event Grid
 * trigger invocation. Implements the already-ported `IHasMessageResult` so
 * `EventGridMessageHandlerResultSetter` can record the handler outcome onto it, and so
 * `EventGridBatchApplication` can read it for `EventGridOptions.raiseOnFailureStatus`.
 */
export class EventGridContext implements IHasMessageResult {
  /**
   * @param event The delivered event.
   */
  constructor(event: EventGridTriggerEvent) {
    this.event = event;
  }

  /** The delivered event. */
  readonly event: EventGridTriggerEvent;

  /**
   * The result of handling this event. Event Grid deliveries are fire-and-forget from the handler's
   * perspective (a thrown exception is what triggers Event Grid's own retry/dead-letter machinery), so
   * this is recorded for middleware/diagnostics only. Unset (C# `null`) until a result has been
   * recorded — `EventGridBatchApplication` reads it via optional chaining, exactly as C# reads
   * `MessageResult?.IsSuccessful`.
   */
  messageResult!: IMessageResult;
}
