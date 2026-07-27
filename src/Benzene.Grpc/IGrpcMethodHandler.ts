import { Metadata, ServerUnaryCall } from '@grpc/grpc-js';

/**
 * The outcome of a successful unary call: the wire response plus the trailing metadata to send (carrying
 * the `benzene-status` trailer). A non-OK call throws {@link GrpcBenzeneError} instead.
 */
export interface GrpcUnaryResult<TResponse> {
  readonly response: TResponse;
  readonly trailer: Metadata;
}

/**
 * Port of Benzene.Grpc.IGrpcMethodHandler — narrowed to the **unary** shape (see the README for the
 * streaming deferral).
 *
 * SCOPE: .NET's interface also declares `ServerStreamingAsync`/`ClientStreamingAsync`/`DuplexStreamingAsync`.
 * Those are deferred; only the unary `handleAsync` is ported.
 */
export interface IGrpcMethodHandler {
  handleAsync<TResponse>(
    call: ServerUnaryCall<unknown, TResponse>,
  ): Promise<GrpcUnaryResult<TResponse>>;
}
