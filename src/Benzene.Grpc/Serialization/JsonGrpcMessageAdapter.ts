import { BenzeneException } from '@benzene/core';
import { IGrpcMessageAdapter } from './IGrpcMessageAdapter';

/**
 * Port of Benzene.Grpc.Serialization.ProtobufJsonGrpcMessageAdapter — retargeted to a **JSON/structural**
 * bridge (documented bend).
 *
 * WHY THE BEND: the .NET adapter converts between a handler POCO and a concrete `Google.Protobuf.IMessage`
 * using protobuf's own `JsonFormatter`/`JsonParser` and a reflected static `Descriptor` property — it needs
 * generated protobuf message *classes* to parse into. `@grpc/grpc-js` deliberately ships **no** message
 * type of its own: the wire codec is pluggable (JSON, or `@grpc/proto-loader`-generated plain objects, or a
 * hand-written protobuf serializer), and by the time a server handler runs, grpc-js has already deserialized
 * the request into a plain JavaScript object. There is therefore no framework protobuf type to reflect a
 * descriptor from, and no faithful place for a protobuf-JSON round-trip.
 *
 * WHAT THIS DOES INSTEAD: a structural pass-through. Both handler payloads and grpc-js wire messages are
 * plain objects with the same field shape, so `convertRequest`/`convertResponse` return the value as-is —
 * which is also exactly the .NET "already the target type ⇒ zero-copy" fast path. A caller needing genuine
 * protobuf types wires a protobuf-aware codec into the grpc-js `Server` (via `@grpc/proto-loader`); the
 * handler still sees plain objects, so this adapter stays correct. `convertResponse(undefined)` throws, as
 * .NET's does for a null response payload.
 *
 * DEFERRED (documented): the protobuf `Descriptor`-driven `JsonParser` path and well-known-type/oneof/enum
 * round-tripping — they require generated protobuf classes that have no framework-level existence in
 * `@grpc/grpc-js`.
 */
export class JsonGrpcMessageAdapter implements IGrpcMessageAdapter {
  convertRequest<TRequest>(message: unknown): TRequest | undefined {
    if (message === undefined || message === null) {
      return undefined;
    }

    return message as TRequest;
  }

  convertResponse<TResponse>(payload: unknown): TResponse {
    if (payload === undefined || payload === null) {
      throw new BenzeneException('Cannot convert a null payload to the gRPC response type.');
    }

    return payload as TResponse;
  }
}
