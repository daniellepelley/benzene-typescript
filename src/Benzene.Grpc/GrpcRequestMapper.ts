import { IRequestMapper } from '@benzenejs/abstractions-message-handlers';
import { GrpcContext } from './GrpcContext';
import { IGrpcMessageAdapter } from './Serialization/IGrpcMessageAdapter';
import { convertStream, isAsyncIterable } from './Streaming/GrpcStreamAdapter';

/**
 * Port of Benzene.Grpc.GrpcRequestMapper.
 *
 * Produces the handler's request from the gRPC request payload: pass-through when it already is the target
 * type, otherwise via the {@link IGrpcMessageAdapter}. For a client-/bidi-streaming call the request is an
 * inbound `AsyncIterable` — mirroring .NET's `GrpcStreamAdapter.TryConvertStream` branch, this lazily wraps
 * it so each item is adapter-converted (a no-op with the default structural adapter). Under type erasure the
 * streaming branch is chosen structurally (the request *is* an async iterable), where .NET reflects on the
 * declared `IAsyncEnumerable<T>` handler type.
 */
export class GrpcRequestMapper implements IRequestMapper<GrpcContext> {
  static readonly inject = [IGrpcMessageAdapter] as const;

  private readonly adapter: IGrpcMessageAdapter;

  constructor(adapter: IGrpcMessageAdapter) {
    this.adapter = adapter;
  }

  getBody<TRequest>(context: GrpcContext): TRequest | undefined {
    const requestAsObject = context.requestAsObject;
    if (isAsyncIterable(requestAsObject)) {
      return convertStream(requestAsObject, this.adapter, false) as TRequest;
    }

    return this.adapter.convertRequest<TRequest>(requestAsObject);
  }
}
