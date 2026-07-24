/** Port of Benzene.Core.MessageHandlers.HeaderMessageVersionGetter. */
import { IMessageVersionGetter } from '@benzene/abstractions-message-handlers';
import { IMessageHeadersGetter, MessageVersionHeaders } from '@benzene/abstractions-messages';

/**
 * Default {@link IMessageVersionGetter}: reads the payload schema version from the context's header
 * dictionary (`IMessageHeadersGetter`), trying each name in the configured list in order and returning
 * the first one present. One implementation serves every transport that has no richer version signal
 * of its own; HTTP layers a route-parameter check in front of an instance of this class.
 */
export class HeaderMessageVersionGetter<TContext> implements IMessageVersionGetter<TContext> {
  /**
   * The default, ordered header-name fallback. The primary name is `MessageVersionHeaders.default`, the
   * same name the outbound helpers write.
   */
  static readonly defaultHeaderNames: readonly string[] = [MessageVersionHeaders.default, 'version', 'x-version'];

  private readonly headerNames: readonly string[];

  /**
   * @param headersGetter Extracts the header dictionary from the context.
   * @param headerNames The header names to try, in order; the first present wins. Defaults to
   * {@link HeaderMessageVersionGetter.defaultHeaderNames}.
   */
  constructor(
    private readonly headersGetter: IMessageHeadersGetter<TContext>,
    headerNames?: readonly string[],
  ) {
    this.headerNames = headerNames ?? HeaderMessageVersionGetter.defaultHeaderNames;
  }

  getVersion(context: TContext): string | undefined {
    const headers = this.headersGetter.getHeaders(context);
    if (headers === undefined || headers === null) {
      return undefined;
    }

    // Matched case-insensitively regardless of the concrete header dictionary ("header keys are
    // case-insensitive on read").
    for (const headerName of this.headerNames) {
      for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === headerName.toLowerCase() && value !== undefined && value !== '') {
          return value;
        }
      }
    }

    return undefined;
  }
}
