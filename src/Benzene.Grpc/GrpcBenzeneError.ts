import { Metadata, ServerErrorResponse, status } from '@grpc/grpc-js';

/**
 * The error {@link GrpcMethodHandler} throws for a non-OK call — the port's stand-in for .NET's
 * `Grpc.Core.RpcException`.
 *
 * SDK-MODEL BEND (`RpcException` → `ServerErrorResponse`): server-side `@grpc/grpc-js` does not surface an
 * `RpcException`; a handler reports a failure by passing an error shaped like `ServerErrorResponse`
 * (`Error` + `{ code, details, metadata }`) to its callback. This class is exactly that shape, so it can
 * be handed straight to a grpc-js `sendUnaryData` callback and grpc-js will send the right status code,
 * details and trailing metadata to the client.
 */
export class GrpcBenzeneError extends Error implements ServerErrorResponse {
  /** The grpc status code sent to the client. */
  readonly code: status;

  /** The human-readable status detail. */
  readonly details: string;

  /** Trailing metadata sent with the error (e.g. the `benzene-status` trailer). */
  readonly metadata?: Metadata;

  constructor(code: status, details: string, metadata?: Metadata) {
    super(details);
    this.name = 'GrpcBenzeneError';
    this.code = code;
    this.details = details;
    this.metadata = metadata;
  }
}
