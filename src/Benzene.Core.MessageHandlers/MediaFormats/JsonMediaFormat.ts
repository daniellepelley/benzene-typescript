import { ISerializer, IServiceResolver } from '@benzene/abstractions';
import { IMediaFormat } from '@benzene/abstractions-message-handlers';
import { JsonSerializer } from '../Serialization/JsonSerializer';

/**
 * The process default `IMediaFormat<TContext>`, wrapping the shared `JsonSerializer`. Injected
 * directly into `MediaFormatNegotiator<TContext>` as its fallback rather than registered as a
 * negotiated candidate — `canRead`/`canWrite` always return `false` since it is never discovered
 * through the matching loop; it is the format used when nothing else matches.
 * Port of Benzene.Core.MessageHandlers.MediaFormats.JsonMediaFormat&lt;TContext&gt;.
 *
 * Per wrinkle 3, `getSerializer` returns the container-resolved `JsonSerializer` (already ported at
 * `@benzene/core-message-handlers`) that this format is constructed with.
 */
export class JsonMediaFormat<TContext> implements IMediaFormat<TContext> {
  constructor(private readonly jsonSerializer: JsonSerializer) {}

  get contentType(): string {
    return 'application/json';
  }

  canRead(_context: TContext, _serviceResolver: IServiceResolver): boolean {
    return false;
  }

  canWrite(_context: TContext, _serviceResolver: IServiceResolver): boolean {
    return false;
  }

  getSerializer(_serviceResolver: IServiceResolver): ISerializer {
    return this.jsonSerializer;
  }
}
