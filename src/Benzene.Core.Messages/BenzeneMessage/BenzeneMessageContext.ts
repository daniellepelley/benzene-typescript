import { IBenzeneMessageRequest } from './IBenzeneMessageRequest';
import { IBenzeneMessageResponse } from './IBenzeneMessageResponse';
import { BenzeneMessageResponse } from './BenzeneMessageResponse';

/**
 * The transport context (request/response envelope) for the transport-agnostic `BenzeneMessage`
 * format: wraps an inbound `IBenzeneMessageRequest` and carries the `IBenzeneMessageResponse` the
 * pipeline populates.
 * Port of Benzene.Core.Messages.BenzeneMessage.BenzeneMessageContext.
 *
 * IMPORTANT: this is DISTINCT from the handler-pipeline `MessageHandlerContext`
 * (`@benzene/core-message-handlers`'s `BenzeneMessageContext.ts` file) — that one is the
 * per-invocation request/response context a single handler sees; this one is the transport envelope
 * a whole pipeline runs over.
 */
export class BenzeneMessageContext {
  readonly benzeneMessageRequest: IBenzeneMessageRequest;
  benzeneMessageResponse: IBenzeneMessageResponse;

  constructor(benzeneMessageRequest: IBenzeneMessageRequest) {
    this.benzeneMessageRequest = benzeneMessageRequest;
    this.benzeneMessageResponse = new BenzeneMessageResponse();
  }
}
