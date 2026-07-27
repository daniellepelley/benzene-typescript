import { Client, ServiceError, status } from '@grpc/grpc-js';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { IGrpcMessageAdapter } from '@benzene/grpc';
import { GrpcSendMessageContext } from './GrpcSendMessageContext';
import { IGrpcClientRouteRegistry } from './IGrpcClientRouteRegistry';

/**
 * Port of Benzene.Grpc.Client.GrpcClientMiddleware.
 *
 * The terminal middleware of an outbound gRPC pipeline: looks up the route for the context's topic, maps
 * a missing route to `status.UNIMPLEMENTED`, and — mirroring .NET's `catch (RpcException)` — captures a
 * call failure's status + trailers onto the context instead of rethrowing. It does not call `next`.
 *
 * BEND (`CallInvoker` → grpc-js `Client`; `RpcException` → {@link ServiceError}): the middleware holds the
 * caller-supplied grpc-js `Client`; the {@link GrpcClientRoute} rejects with a `ServiceError`
 * (`StatusObject & Error`) on a non-OK call, which is caught here and unpacked into `code`/`details`/
 * `metadata` — the grpc-js analog of `RpcException.Status`/`RpcException.Trailers`.
 */
export class GrpcClientMiddleware implements IMiddleware<GrpcSendMessageContext> {
  readonly name = 'GrpcClientMiddleware';

  constructor(
    private readonly client: Client,
    private readonly routeRegistry: IGrpcClientRouteRegistry,
    private readonly adapter: IGrpcMessageAdapter,
  ) {}

  async handleAsync(context: GrpcSendMessageContext, _next: NextFunc): Promise<void> {
    const route = this.routeRegistry.find(context.topic);
    if (route === undefined) {
      context.status = {
        code: status.UNIMPLEMENTED,
        details: `No gRPC route has been registered for topic '${context.topic}'.`,
      };
      return;
    }

    try {
      await route.invokeAsync(this.client, this.adapter, context);
    } catch (ex) {
      const error = ex as ServiceError;
      context.status = { code: error.code, details: error.details ?? error.message };
      context.responseTrailers = error.metadata;
    }
  }
}
