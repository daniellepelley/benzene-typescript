import { ISerializer, VoidResult } from '@benzene/abstractions';
import { IContextConverter } from '@benzene/abstractions-middleware';
import { JsonSerializer } from '@benzene/core-message-handlers';
import { OutboundContext } from '@benzene/clients';
import { BenzeneResult } from '@benzene/results';
import { buildInProcessRequest } from './InProcessRequestBuilder';
import { InProcessSendMessageContext } from './InProcessSendMessageContext';

/**
 * Converts between an outbound `OutboundContext` and an `InProcessSendMessageContext`, so an
 * outbound route (`OutboundRoutingBuilder.route`) can dispatch straight to an in-process handler
 * registered via `addInProcessMessaging`, without going over any wire transport.
 * Port of Benzene.Clients.InProcess.InProcessContextConverter.
 *
 * PORT DIVERGENCE from .NET: the .NET converter maps the dispatched handler's response onto
 * `OutboundContext.Response` as a raw `BenzeneMessageClientResponse` envelope, which
 * `DefaultBenzeneMessageSender` then deserializes into the caller's requested `TResponse` once it
 * knows that type. The TypeScript port's `IContextConverter<TContextIn, TContextOut>` and
 * `DefaultBenzeneMessageSender.sendAsync<TRequest, TResponse>` have no equivalent mechanism -
 * `TResponse` is erased everywhere in the outbound pipeline, and no converter in this port (SQS, SNS,
 * ...) produces a genuinely `TResponse`-typed result; every one of them, this one included, always
 * produces a fixed `VoidResult`. This is not a shortcoming specific to this converter - it is the
 * existing constraint every TS outbound transport already has (see `Benzene.Clients/Common/
 * ClientResultExtensions.ts`'s own note that the `AsBenzeneResult`/`BenzeneMessageClientResponse`
 * deserialization suite is deferred). A topic routed here must be sent via
 * `IBenzeneMessageSender.sendAsync<TRequest, VoidResult>` for the response to mean anything -
 * requesting a different `TResponse` is undetectable at runtime (the same erasure caveat
 * `OutboundResponseTypeMismatchException` already documents for SQS/SNS), not a hard error.
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
    contextIn.response = BenzeneResult.set<VoidResult>(contextOut.response.statusCode, new VoidResult());
    return Promise.resolve();
  }
}
