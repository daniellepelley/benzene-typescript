import { IRequestMapper } from '@benzene/abstractions-message-handlers';
import { GrpcContext } from './GrpcContext';
import { IGrpcMessageAdapter } from './Serialization/IGrpcMessageAdapter';

/**
 * Port of Benzene.Grpc.GrpcRequestMapper.
 *
 * Produces the handler's request from the gRPC request payload: pass-through when it already is the target
 * type, otherwise via the {@link IGrpcMessageAdapter}.
 *
 * DEFERRED (documented): .NET also lazily wraps an `IAsyncEnumerable<T>` request *stream* via
 * `GrpcStreamAdapter` for client/bidi-streaming handlers. This is the unary core, so the streaming branch
 * is omitted — see the package README for the streaming deferral.
 */
export class GrpcRequestMapper implements IRequestMapper<GrpcContext> {
  static readonly inject = [IGrpcMessageAdapter] as const;

  private readonly adapter: IGrpcMessageAdapter;

  constructor(adapter: IGrpcMessageAdapter) {
    this.adapter = adapter;
  }

  getBody<TRequest>(context: GrpcContext): TRequest | undefined {
    return this.adapter.convertRequest<TRequest>(context.requestAsObject);
  }
}
