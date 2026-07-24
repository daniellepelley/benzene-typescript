import { Constructor, ServiceIdentifier, serviceIdentifierName } from '@benzene/abstractions';
import { ITopic } from '@benzene/abstractions-messages';

/**
 * One finding from the unmapped-response-handler diagnostic
 * ({@link findUnmappedResponseHandlers}): a handler that returns a response payload on a topic no
 * response-event mapping covers. On a fire-and-forget transport that payload is discarded after the
 * message is acknowledged; if it should become an event, a `useResponseEvents` mapping is missing.
 * Port of Benzene.ResponseEvents.ResponseEventGap.
 */
export class ResponseEventGap {
  /** The topic the handler answers. */
  readonly topic: ITopic;

  /** The handler type. */
  readonly handlerType: Constructor<unknown>;

  /** The response payload type the handler returns but that has nowhere to go on a fire-and-forget transport. */
  readonly responseType: ServiceIdentifier<unknown>;

  constructor(topic: ITopic, handlerType: Constructor<unknown>, responseType: ServiceIdentifier<unknown>) {
    this.topic = topic;
    this.handlerType = handlerType;
    this.responseType = responseType;
  }

  /** A human-readable summary of the gap, for logging. */
  get description(): string {
    return (
      `Handler ${serviceIdentifierName(this.handlerType)} on topic '${this.topic.id}' returns a ` +
      `${serviceIdentifierName(this.responseType)} response, but no response-event mapping covers it - ` +
      'on a fire-and-forget transport that payload is discarded. Add a useResponseEvents mapping if you ' +
      'intend to publish it as an event (safe to ignore for a topic served only over HTTP/gRPC, where ' +
      'the response is the reply).'
    );
  }
}
