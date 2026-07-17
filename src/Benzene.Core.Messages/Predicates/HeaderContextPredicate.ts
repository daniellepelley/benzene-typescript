import { IServiceResolver } from '@benzene/abstractions';
import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { IContextPredicate } from '@benzene/abstractions-middleware';

/**
 * Matches a context whose `IMessageHeadersGetter`-exposed headers contain the configured header name
 * with exactly the configured value. Subclasses can override `isMatch` to change how the header's
 * actual value is compared against the expected one (e.g. `MediaTypeHeaderContextPredicate` for
 * parameter/case-tolerant media-type matching) without duplicating the header lookup itself.
 * Port of Benzene.Core.Messages.Predicates.HeaderContextPredicate&lt;TContext&gt;.
 */
export class HeaderContextPredicate<TContext> implements IContextPredicate<TContext> {
  constructor(
    private readonly headerKey: string,
    private readonly headerValue: string,
  ) {}

  check(context: TContext, serviceResolver: IServiceResolver): boolean {
    const messageHeadersMapper = serviceResolver.getService(
      IMessageHeadersGetter,
    ) as IMessageHeadersGetter<TContext>;
    const headers = messageHeadersMapper.getHeaders(context);

    if (headers === undefined) {
      return false;
    }

    const actualValue = headers[this.headerKey];
    return actualValue !== undefined && this.isMatch(actualValue, this.headerValue);
  }

  /**
   * Compares the header's actual value against the expected value. The default is exact string
   * equality, preserving this class's behavior for non-media-type headers.
   */
  protected isMatch(actualValue: string, expectedValue: string): boolean {
    return actualValue === expectedValue;
  }
}
