import { IBenzeneMessageRequest, IBenzeneMessageResponse } from '@benzene/core-messages';

/**
 * The middleware pipeline context for dispatching a single message to an in-process handler, in the
 * shared `IBenzeneMessageRequest`/`IBenzeneMessageResponse` envelope every transport uses - the
 * in-process counterpart of `SqsSendMessageContext`.
 * Port of Benzene.Clients.InProcess.InProcessSendMessageContext.
 */
export class InProcessSendMessageContext {
  /** The in-process message response, set by `InProcessClientMiddleware`. */
  response!: IBenzeneMessageResponse;

  constructor(readonly request: IBenzeneMessageRequest) {}
}
