import { CallOptions, Client, ServiceError, StatusObject, status } from '@grpc/grpc-js';
import { IGrpcMessageAdapter } from '@benzenejs/grpc';
import { GrpcSendMessageContext } from './GrpcSendMessageContext';
import { IGrpcClientRoute } from './IGrpcClientRoute';

/**
 * A request/response wire codec for a gRPC unary call — the port's stand-in for the protobuf
 * `Marshaller<T>` pair that .NET's `Method<TRequest,TResponse>` carries.
 *
 * BEND (protobuf `Marshallers.Create` → a `serialize`/`deserialize` `Buffer` pair): `@grpc/grpc-js` ships
 * no framework message type, so `makeUnaryRequest` takes an explicit serialize/deserialize pair. The
 * default (see {@link jsonGrpcMarshaller}) is a JSON codec — the exact analog of `@benzenejs/grpc`'s
 * {@link JsonGrpcMessageAdapter} bend. A caller talking to a protobuf service passes a protobuf-aware
 * marshaller matching that method instead.
 */
export interface GrpcClientMarshaller<TRequest, TResponse> {
  serialize: (value: TRequest) => Buffer;
  deserialize: (value: Buffer) => TResponse;
}

/** The default JSON wire codec used when a route is registered without an explicit marshaller. */
export const jsonGrpcMarshaller: GrpcClientMarshaller<unknown, unknown> = {
  serialize: (value) => Buffer.from(JSON.stringify(value ?? null), 'utf8'),
  deserialize: (bytes) => JSON.parse(bytes.toString('utf8')) as unknown,
};

/**
 * Port of Benzene.Grpc.Client.GrpcClientRoute&lt;TRequest, TResponse&gt;.
 *
 * The closed-generic call site. Converts the outbound payload via
 * {@link IGrpcMessageAdapter.convertResponse} (produce-a-wire-message-from-a-payload — the same
 * direction the server uses for its own responses), performs the unary call, and stores the raw wire
 * response back on the context untouched; converting that into the caller's own response type is
 * {@link GrpcBenzeneMessageClient}'s job.
 *
 * BEND (`CallInvoker.AsyncUnaryCall` → `Client.makeUnaryRequest`): grpc-js reports a non-OK call by
 * passing a {@link ServiceError} (`StatusObject & Error`, carrying `code`/`details`/`metadata`) to the
 * unary callback rather than throwing. The port rejects the returned promise with that error, so the
 * `try/catch` in {@link GrpcClientMiddleware} captures the status + trailers exactly as .NET's
 * `catch (RpcException)` does. On success the trailing `benzene-status` metadata arrives only on the
 * call's `status` event (the unary callback carries just the message), so the route reads status +
 * trailers from that event — grpc-js fires the callback first, then emits `status`.
 */
export class GrpcClientRoute<TRequest, TResponse> implements IGrpcClientRoute {
  constructor(
    private readonly path: string,
    private readonly marshaller: GrpcClientMarshaller<TRequest, TResponse>,
  ) {}

  invokeAsync(client: Client, adapter: IGrpcMessageAdapter, context: GrpcSendMessageContext): Promise<void> {
    const request = adapter.convertResponse<TRequest>(context.message);
    const options: CallOptions = context.deadline ? { deadline: context.deadline } : {};

    return new Promise<void>((resolve, reject) => {
      let responseMessage: TResponse | undefined;

      const call = client.makeUnaryRequest<TRequest, TResponse>(
        this.path,
        this.marshaller.serialize,
        this.marshaller.deserialize,
        request,
        context.headers,
        options,
        (error: ServiceError | null, value?: TResponse) => {
          if (error) {
            // Mirror .NET: an RpcException surfaces to the middleware, which records its status/trailers.
            reject(error);
          } else {
            responseMessage = value;
          }
        },
      );

      call.on('status', (statusObject: StatusObject) => {
        context.status = { code: statusObject.code, details: statusObject.details };
        context.responseTrailers = statusObject.metadata;
        if (statusObject.code === status.OK) {
          context.response = responseMessage;
        }
        resolve();
      });
    });
  }
}
