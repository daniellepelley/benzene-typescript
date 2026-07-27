import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { ServerUnaryCall } from '@grpc/grpc-js';

/**
 * Port of Benzene.Grpc.IGrpcServerCallAccessor.
 *
 * Gives message handlers access to the current gRPC call — notably its cancellation state — without
 * coupling the handler to Benzene's transport types. Analogous to ASP.NET Core's `IHttpContextAccessor`
 * (and the .NET `IGrpcServerCallAccessor`, which exposes the `ServerCallContext`/`CancellationToken`).
 *
 * BEND (`ServerCallContext`/`CancellationToken` → `ServerUnaryCall`/`cancelled`): the port exposes the
 * grpc-js `call` and its boolean `cancelled` flag (the `@grpc/grpc-js` analog of
 * `CancellationToken.IsCancellationRequested`), following the README's `CancellationToken` → cancellation-
 * signal mapping. There is no ambient cancellation-token DI seam in the port yet (see the SQS/Service Bus
 * notes), so this accessor is how a handler observes cancellation over gRPC.
 */
export interface IGrpcServerCallAccessor {
  /** The current call, or `undefined` outside of a gRPC call. */
  readonly call: ServerUnaryCall<unknown, unknown> | undefined;

  /** Whether the current call has been cancelled (`false` outside of a gRPC call). */
  readonly cancelled: boolean;
}

export const IGrpcServerCallAccessor: ServiceToken<IGrpcServerCallAccessor> =
  serviceToken<IGrpcServerCallAccessor>('IGrpcServerCallAccessor');
