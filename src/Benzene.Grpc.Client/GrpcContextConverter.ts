import { VoidResult } from '@benzene/abstractions';
import { IBenzeneClientContext } from '@benzene/abstractions-messages';
import { IContextConverter } from '@benzene/abstractions-middleware';
import { BenzeneResult } from '@benzene/results';
import { Metadata, status } from '@grpc/grpc-js';
import { GrpcSendMessageContext } from './GrpcSendMessageContext';

/**
 * Port of Benzene.Grpc.Client.GrpcContextConverter&lt;T&gt;.
 *
 * Bridges a `VoidResult`-response outbound client context (`IBenzeneClientContext<T, VoidResult>`) onto a
 * {@link GrpcSendMessageContext}, for embedding a gRPC send as one step of a broader client pipeline (see
 * {@link useGrpc}). {@link GrpcBenzeneMessageClient} does not use this converter's `mapResponseAsync` — it
 * inspects the real, typed gRPC response itself — this class exists for the pipeline-embedding building
 * block, exactly as in .NET.
 *
 * DEFERRED (inbound cancellation/deadline propagation): .NET's converter can carry a `CancellationToken`
 * and an absolute deadline. `@grpc/grpc-js` has no cancellation-token field and the port has no ambient
 * cancellation-token DI seam, so only an optional deadline (`Date`) is carried onto the outbound call.
 */
export class GrpcContextConverter<T>
  implements IContextConverter<IBenzeneClientContext<T, VoidResult>, GrpcSendMessageContext>
{
  constructor(private readonly deadline?: Date) {}

  createRequestAsync(contextIn: IBenzeneClientContext<T, VoidResult>): Promise<GrpcSendMessageContext> {
    const headers = new Metadata();
    for (const [key, value] of Object.entries(contextIn.request.headers)) {
      headers.add(key, value);
    }

    return Promise.resolve(
      new GrpcSendMessageContext(contextIn.request.topic, contextIn.request.message, headers, this.deadline),
    );
  }

  mapResponseAsync(
    contextIn: IBenzeneClientContext<T, VoidResult>,
    contextOut: GrpcSendMessageContext,
  ): Promise<void> {
    contextIn.response =
      contextOut.status.code === status.OK
        ? BenzeneResult.ok<VoidResult>()
        : BenzeneResult.serviceUnavailable<VoidResult>(contextOut.status.details);
    return Promise.resolve();
  }
}
