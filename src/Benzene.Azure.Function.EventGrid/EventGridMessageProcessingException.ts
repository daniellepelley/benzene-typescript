/** Port of Benzene.Azure.Function.EventGrid.EventGridMessageProcessingException. */

/**
 * Thrown by `EventGridBatchApplication` when `EventGridOptions.raiseOnFailureStatus` is enabled and a
 * message handler reported an unsuccessful result without itself throwing — escalating the failure into
 * an exception so Event Grid's own retry/dead-letter policy applies the same way it would for an
 * unhandled exception. C# `Exception` maps to `Error`.
 */
export class EventGridMessageProcessingException extends Error {
  /** The Event Grid event id the handler reported a failure for. */
  readonly eventId: string;

  constructor(eventId: string) {
    super(`Message handler reported an unsuccessful result for Event Grid event ${eventId}.`);
    this.name = 'EventGridMessageProcessingException';
    this.eventId = eventId;
  }
}
