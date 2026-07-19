/** Port of Benzene.Xml.XmlMediaFormat. */
import { ISerializer, IServiceResolver } from '@benzene/abstractions';
import { AcceptHeaderMediaFormatBase } from '@benzene/core-message-handlers';
import { Constants } from './Constants';
import { XmlSerializer } from './XmlSerializer';

/**
 * XML `IMediaFormat<TContext>`: selected to read a request when its `content-type` is
 * `application/xml`, and to write a response when `application/xml` appears in its `accept` header.
 * Port of Benzene.Xml.XmlMediaFormat&lt;TContext&gt;.
 *
 * Extends the ported {@link AcceptHeaderMediaFormatBase} exactly like `JsonMediaFormat` /
 * `AvroMediaFormat` / `MessagePackMediaFormat`; the shared {@link XmlSerializer} it wraps is supplied at
 * construction (the port has no reflective constructor injection, so the format is built with the
 * serializer rather than resolving it).
 */
export class XmlMediaFormat<TContext> extends AcceptHeaderMediaFormatBase<TContext> {
  constructor(private readonly xmlSerializer: XmlSerializer) {
    super();
  }

  get contentType(): string {
    return Constants.xmlContentType;
  }

  getSerializer(_serviceResolver: IServiceResolver): ISerializer {
    return this.xmlSerializer;
  }
}
