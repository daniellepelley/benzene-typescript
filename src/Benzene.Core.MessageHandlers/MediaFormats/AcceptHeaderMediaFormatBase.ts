import { ISerializer, IServiceResolver } from '@benzene/abstractions';
import { IMediaFormat } from '@benzene/abstractions-message-handlers';
import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { MediaType } from '@benzene/core-messages';

/**
 * Base `IMediaFormat<TContext>` for header-negotiated formats: reads are selected by a `content-type`
 * match, writes by an `accept` match, both tolerant of `;`-delimited parameters and casing via
 * `MediaType.matches`.
 * Port of Benzene.Core.MessageHandlers.MediaFormats.AcceptHeaderMediaFormatBase&lt;TContext&gt;.
 *
 * `accept` is split on `,` and each token compared individually, so a multi-value header matches
 * whichever registered format's content type appears anywhere in the list. A bare `*​/*` token
 * intentionally does not match any specific format (it signals "no preference", which the negotiator
 * already expresses by falling back to the read format).
 */
export abstract class AcceptHeaderMediaFormatBase<TContext> implements IMediaFormat<TContext> {
  private static readonly contentTypeHeader = 'content-type';
  private static readonly acceptHeader = 'accept';

  abstract get contentType(): string;

  abstract getSerializer(serviceResolver: IServiceResolver): ISerializer;

  canRead(context: TContext, serviceResolver: IServiceResolver): boolean {
    return this.headerMatches(context, serviceResolver, AcceptHeaderMediaFormatBase.contentTypeHeader);
  }

  canWrite(context: TContext, serviceResolver: IServiceResolver): boolean {
    const headers = this.getHeaders(context, serviceResolver);
    const accept = headers?.[AcceptHeaderMediaFormatBase.acceptHeader];
    if (accept === undefined || accept === '') {
      return false;
    }

    return accept.split(',').some((token) => MediaType.matches(token, this.contentType));
  }

  private headerMatches(context: TContext, serviceResolver: IServiceResolver, headerKey: string): boolean {
    const headers = this.getHeaders(context, serviceResolver);
    return headers !== undefined && MediaType.matches(headers[headerKey], this.contentType);
  }

  private getHeaders(context: TContext, serviceResolver: IServiceResolver): Record<string, string> | undefined {
    return (
      serviceResolver.getService(IMessageHeadersGetter) as IMessageHeadersGetter<TContext>
    ).getHeaders(context);
  }
}
