/** Port of Benzene.Core.MessageHandlers.HeaderMessageVersionGetter. */
import { IMessageVersionGetter } from '@benzenejs/abstractions-message-handlers';
import { IMessageHeadersGetter, MessageVersionHeaders } from '@benzenejs/abstractions-messages';

/**
 * Default {@link IMessageVersionGetter}: reads the message's version from **one** header of the context's
 * header dictionary (`IMessageHeadersGetter`) — `benzene-version` unless the application renamed it with
 * `addMessageVersionHeaderName`. One implementation serves every transport that has no richer version
 * signal of its own.
 *
 * One name, no fallback list (wire-contracts §2, versioning.md §2.1): a producer's own `version` or
 * `x-version` header is an ordinary header and selects nothing, because reading it would silently route a
 * message to another version's handler. A configured name replaces the default; it does not join a list.
 *
 * DIVERGENCE: the .NET getter (at the time of porting) still takes an ordered list of names. The spec
 * removed the list in spec-0.2.0 (D10), so the port takes exactly one name.
 */
export class HeaderMessageVersionGetter<TContext> implements IMessageVersionGetter<TContext> {
  /** The default version header: `benzene-version` — the same name the outbound helpers write. */
  static readonly defaultHeaderName: string = MessageVersionHeaders.default;

  private readonly headerName: string;

  /**
   * @param headersGetter Extracts the header dictionary from the context.
   * @param headerName The header the version is read from. Defaults to
   * {@link HeaderMessageVersionGetter.defaultHeaderName}.
   */
  constructor(
    private readonly headersGetter: IMessageHeadersGetter<TContext>,
    headerName?: string,
  ) {
    this.headerName = headerName === undefined || headerName === '' ? HeaderMessageVersionGetter.defaultHeaderName : headerName;
  }

  getVersion(context: TContext): string | undefined {
    const headers = this.headersGetter.getHeaders(context);
    if (headers === undefined || headers === null) {
      return undefined;
    }

    // Matched case-insensitively regardless of the concrete header dictionary ("header keys are
    // case-insensitive on read").
    const wanted = this.headerName.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === wanted && value !== undefined && value !== '') {
        return value;
      }
    }

    return undefined;
  }
}
