/** Port of Benzene.MessagePack.MessagePackMediaFormat. */
import { ISerializer, IServiceResolver } from '@benzene/abstractions';
import { AcceptHeaderMediaFormatBase } from '@benzene/core-message-handlers';
import { Constants } from './Constants';
import { MessagePackSerializer } from './MessagePackSerializer';

/**
 * MessagePack `IMediaFormat<TContext>`: selected to read a request when its `content-type` is
 * `application/msgpack`, and to write a response when `application/msgpack` appears in its `accept`
 * header.
 * Port of Benzene.MessagePack.MessagePackMediaFormat&lt;TContext&gt;.
 *
 * Extends the ported {@link AcceptHeaderMediaFormatBase} exactly like `JsonMediaFormat` /
 * `AvroMediaFormat`; the shared {@link MessagePackSerializer} it wraps is supplied at construction (the
 * port has no reflective constructor injection, so the format is built with the serializer rather than
 * resolving it).
 */
export class MessagePackMediaFormat<TContext> extends AcceptHeaderMediaFormatBase<TContext> {
  constructor(private readonly messagePackSerializer: MessagePackSerializer) {
    super();
  }

  get contentType(): string {
    return Constants.messagePackContentType;
  }

  getSerializer(_serviceResolver: IServiceResolver): ISerializer {
    return this.messagePackSerializer;
  }
}
