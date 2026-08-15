import { ISerializer } from '@benzenejs/abstractions';
import { IContextConverter } from '@benzenejs/abstractions-middleware';
import { JsonSerializer } from '@benzenejs/core-message-handlers';
import { BenzeneMessageClientResponse, OutboundContext } from '@benzenejs/clients';
import { buildInProcessRequest } from './InProcessRequestBuilder';
import { InProcessSendMessageContext } from './InProcessSendMessageContext';

/**
 * Converts between an outbound `OutboundContext` and an `InProcessSendMessageContext`, so an
 * outbound route (`OutboundRoutingBuilder.route`) can dispatch straight to an in-process handler
 * registered via `addInProcessMessaging`, without going over any wire transport.
 * Port of Benzene.Clients.InProcess.InProcessContextConverter.
 *
 * Like .NET, this maps the dispatched handler's response onto `OutboundContext.response` as a raw
 * {@link BenzeneMessageClientResponse} envelope, which `DefaultBenzeneMessageSender` then deserializes into
 * the caller's requested `TResponse`. So `sendAsync<TRequest, TResponse>` through an in-process route returns
 * the handler's real, typed response — not the `VoidResult` earlier revisions produced.
 *
 * DIVERGENCE: the response body is recovered structurally (`JSON.parse` + a cast), since TypeScript has no
 * runtime `TResponse` to reconstruct — the same mechanism the HTTP client uses. A body that doesn't match
 * `TResponse` yields a mis-shaped object rather than an error; compose a validator on the response if that
 * matters. (Fire-and-forget transports like SQS/SNS have no response body and correctly still return
 * `VoidResult`.)
 */
export class InProcessContextConverter implements IContextConverter<OutboundContext, InProcessSendMessageContext> {
  private readonly serializer: ISerializer;

  constructor(serializer?: ISerializer) {
    this.serializer = serializer ?? new JsonSerializer();
  }

  createRequestAsync(contextIn: OutboundContext): Promise<InProcessSendMessageContext> {
    return Promise.resolve(new InProcessSendMessageContext(buildInProcessRequest(contextIn, this.serializer)));
  }

  mapResponseAsync(contextIn: OutboundContext, contextOut: InProcessSendMessageContext): Promise<void> {
    // The dispatched handler's response is a serialized BenzeneMessage envelope; leave it raw for
    // DefaultBenzeneMessageSender to deserialize into the caller's TResponse — the one frame that still has
    // that type. (Previously collapsed to a fixed VoidResult, discarding the handler's real response.)
    const response = contextOut.response;
    contextIn.response = new BenzeneMessageClientResponse(
      response.statusCode,
      response.body,
      response.headers,
      response.isSuccessful,
    );
    return Promise.resolve();
  }
}
