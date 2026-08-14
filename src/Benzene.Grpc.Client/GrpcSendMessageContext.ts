import { Metadata, status } from '@grpc/grpc-js';

/**
 * The outcome of a gRPC call, as captured onto {@link GrpcSendMessageContext}. Port of the pair of
 * `Grpc.Core.Status` fields (`StatusCode` + `Detail`) that .NET's `GrpcSendMessageContext.Status` holds.
 */
export interface GrpcCallStatus {
  /** The gRPC status code of the call (`status.OK` on success). */
  readonly code: status;

  /** The status detail message (empty on success). */
  readonly details: string;
}

/**
 * Port of Benzene.Grpc.Client.GrpcSendMessageContext.
 *
 * The middleware-pipeline context for one outbound gRPC unary call: the topic, the boxed outbound
 * message, the request headers, and an optional call deadline in; the raw response object, the call
 * {@link GrpcCallStatus}, and the response trailers out.
 *
 * BEND (`Grpc.Core.Metadata` → grpc-js `Metadata`): headers and response trailers use grpc-js's
 * `Metadata`, the type its `Client.makeUnaryRequest` accepts and its callback / `status` event surface.
 *
 * DEFERRED (`CancellationToken` dropped; deadline kept as an optional `Date`): .NET's context also
 * carries a `CancellationToken`. `@grpc/grpc-js`'s `CallOptions` has no cancellation-token field (and the
 * port has no ambient cancellation-token DI seam — see `@benzenejs/grpc`'s `IGrpcServerCallAccessor` note),
 * so it is dropped. The deadline maps to grpc-js `CallOptions.deadline` (a `Date`), and is carried here so
 * a caller embedding a send in a broader pipeline can still set one; {@link GrpcBenzeneMessageClient}
 * itself sends none by default (the inbound-deadline propagation is deferred — see that class).
 */
export class GrpcSendMessageContext {
  /** The raw gRPC response message, set by {@link GrpcClientRoute} on a successful call. */
  response?: unknown;

  /** The call status, set by the route (on success) or by {@link GrpcClientMiddleware} (on failure). */
  status: GrpcCallStatus = { code: status.OK, details: '' };

  /** The response trailing metadata, set from the call's `status` event or a caught call error. */
  responseTrailers?: Metadata;

  constructor(
    readonly topic: string,
    readonly message: unknown,
    readonly headers: Metadata,
    readonly deadline?: Date,
  ) {}
}
