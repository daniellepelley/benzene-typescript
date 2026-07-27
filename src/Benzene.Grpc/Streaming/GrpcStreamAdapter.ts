import { EventEmitter, once } from 'node:events';
import { IGrpcMessageAdapter } from '../Serialization/IGrpcMessageAdapter';

/**
 * The outbound response-stream surface {@link writeAll} needs: a grpc-js object-mode writable
 * ({@link import('@grpc/grpc-js').ServerWritableStream}/`ServerDuplexStream`) — an `EventEmitter` (for the
 * `'drain'` backpressure signal) exposing `write(item): boolean`. Declared structurally because grpc-js's
 * own `ObjectWritable<T>` type is internal and not re-exported from the package root.
 */
export type GrpcResponseStreamWriter<T> = EventEmitter & {
  write(chunk: T): boolean;
};

/**
 * Port of Benzene.Grpc.Streaming.GrpcStreamAdapter.
 *
 * Bridges gRPC's streaming primitives and `AsyncIterable<T>` — the shape Benzene message handlers use for
 * stream request/response items — converting per item via {@link IGrpcMessageAdapter} when a handler
 * declares a non-wire item type.
 *
 * SDK-MODEL BEND (`IAsyncStreamReader<T>`/`IServerStreamWriter<T>` → grpc-js
 * `ServerReadableStream`/`ServerWritableStream`, and `IAsyncEnumerable<T>` → `AsyncIterable<T>`): .NET reads
 * an inbound stream through `IAsyncStreamReader<T>.MoveNext`/`.Current` and writes an outbound stream through
 * `IServerStreamWriter<T>.WriteAsync`. `@grpc/grpc-js` models the read side as a Node object-mode `Readable`
 * (which is *already* an `AsyncIterable`) and the write side as an object-mode `Writable`
 * ({@link ObjectWritable}) whose `write(item)`/`end()` push messages and honour backpressure via the
 * `'drain'` event. So {@link readAll} is a thin async-generator wrapper over the readable (the analog of the
 * `MoveNext` loop) and {@link writeAll} pumps an `AsyncIterable` into the writable with backpressure.
 *
 * ERASURE BEND (reflection → structural `Symbol.asyncIterator` check): .NET's `TryConvertStream` reflects on
 * `IAsyncEnumerable<>` generic arguments to build a lazily-converting stream of the right item type.
 * TypeScript erases generics, so {@link tryConvertStream} detects a stream *structurally* (an object with a
 * `Symbol.asyncIterator`) and {@link convertStream} maps each item through the adapter without knowing the
 * item type — which, with the default structural {@link import('../Serialization/JsonGrpcMessageAdapter').JsonGrpcMessageAdapter},
 * is an identity pass-through, exactly the .NET fast path.
 */

/** Whether `value` is an async-iterable stream (an object exposing `Symbol.asyncIterator`). */
export function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    value != null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
  );
}

/**
 * Adapts an inbound gRPC request stream to an `AsyncIterable<T>`. The grpc-js readable is already async-
 * iterable, so this simply re-yields it (the analog of .NET's `ReadAll` `MoveNext` loop) — giving the
 * pipeline a clean `AsyncIterable<T>` seam independent of the concrete grpc-js stream type.
 */
export async function* readAll<T>(source: AsyncIterable<T>): AsyncIterable<T> {
  for await (const item of source) {
    yield item;
  }
}

/**
 * Writes every item of `source` to an outbound gRPC response stream, honouring backpressure: when
 * `writer.write` reports the buffer is full (returns `false`) it awaits the `'drain'` event before
 * continuing. Does **not** call `writer.end()` — the caller ends the stream (with trailing metadata) once
 * the pipeline's trailer is known, mirroring how the unary path sends its trailer last.
 */
export async function writeAll<T>(
  source: AsyncIterable<T>,
  writer: GrpcResponseStreamWriter<T>,
): Promise<void> {
  for await (const item of source) {
    if (!writer.write(item)) {
      await once(writer, 'drain');
    }
  }
}

/**
 * Lazily maps each item of `source` through the {@link IGrpcMessageAdapter}. `isResponseDirection` selects
 * the direction — `convertResponse` for outbound response-stream items (POCO → wire), `convertRequest` for
 * inbound request-stream items (wire → POCO). These are genuinely different directions (as the .NET adapter
 * notes); using the wrong one silently produces the wrong bridging path.
 */
export async function* convertStream(
  source: AsyncIterable<unknown>,
  adapter: IGrpcMessageAdapter,
  isResponseDirection: boolean,
): AsyncIterable<unknown> {
  for await (const item of source) {
    yield isResponseDirection ? adapter.convertResponse(item) : adapter.convertRequest(item);
  }
}

/**
 * If `source` is an async-iterable stream, returns a lazily-converting `AsyncIterable` that maps each item
 * through `adapter`; otherwise returns `undefined` (i.e. this isn't a streaming request/response at all).
 * Port of .NET's `TryConvertStream`, with the reflective item-type match replaced by the structural
 * {@link isAsyncIterable} check (see the module remarks).
 */
export function tryConvertStream(
  source: unknown,
  adapter: IGrpcMessageAdapter,
  isResponseDirection: boolean,
): AsyncIterable<unknown> | undefined {
  if (!isAsyncIterable(source)) {
    return undefined;
  }

  return convertStream(source, adapter, isResponseDirection);
}
