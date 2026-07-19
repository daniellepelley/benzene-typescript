/** Port of Benzene.Avro.AvroMediaFormat. */
import { ISerializer, IServiceResolver } from '@benzene/abstractions';
import { AcceptHeaderMediaFormatBase } from '@benzene/core-message-handlers';
import { AvroSerializer } from './AvroSerializer';
import { Constants } from './Constants';

/**
 * Avro `IMediaFormat<TContext>`: selected to read a request when its `content-type` is
 * `application/avro`, and to write a response when `application/avro` appears in its `accept` header.
 * Port of Benzene.Avro.AvroMediaFormat&lt;TContext&gt;.
 *
 * Extends the ported {@link AcceptHeaderMediaFormatBase} exactly like `JsonMediaFormat`; the shared
 * {@link AvroSerializer} it wraps is supplied at construction (the port has no reflective constructor
 * injection, so the format is built with the serializer rather than resolving it).
 */
export class AvroMediaFormat<TContext> extends AcceptHeaderMediaFormatBase<TContext> {
  constructor(private readonly avroSerializer: AvroSerializer) {
    super();
  }

  get contentType(): string {
    return Constants.avroContentType;
  }

  getSerializer(_serviceResolver: IServiceResolver): ISerializer {
    return this.avroSerializer;
  }
}
