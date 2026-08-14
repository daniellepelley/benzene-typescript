import { IMessageHeadersGetter } from '@benzenejs/abstractions-messages';
import { GrpcContext } from './GrpcContext';

/**
 * Port of Benzene.Grpc.GrpcMessageHeadersGetter.
 *
 * Maps the inbound call {@link import('@grpc/grpc-js').Metadata} to Benzene headers, skipping binary
 * entries, so header-driven middleware (correlation IDs, etc.) work unchanged over gRPC.
 *
 * BEND (`RequestHeaders`/`entry.IsBinary` → grpc-js `Metadata`): grpc-js marks a binary entry by a
 * `-bin`-suffixed key (whose values are `Buffer`), the wire convention .NET's `IsBinary` also reflects, so
 * `-bin` keys are skipped. As in .NET, on duplicate keys the last value wins (grpc-js `getMap()` keeps only
 * the first, so `get(key)` is used to take the last string value).
 */
export class GrpcMessageHeadersGetter implements IMessageHeadersGetter<GrpcContext> {
  getHeaders(context: GrpcContext): Record<string, string> {
    const headers: Record<string, string> = {};
    const metadata = context.call.metadata;

    for (const key of Object.keys(metadata.getMap())) {
      if (key.endsWith('-bin')) {
        continue;
      }

      const values = metadata.get(key);
      const last = values[values.length - 1];
      if (typeof last === 'string') {
        headers[key] = last;
      }
    }

    return headers;
  }
}
