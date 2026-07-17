import { MediaType } from '../Helper/MediaType';
import { HeaderContextPredicate } from './HeaderContextPredicate';

/**
 * `HeaderContextPredicate` for matching a media-type header (e.g. `content-type`) tolerant of
 * `;`-delimited parameters and casing, via `MediaType.matches` — unlike the base class's
 * exact-equality default, `"application/xml; charset=utf-8"` matches a predicate constructed for
 * `"application/xml"`.
 * Port of Benzene.Core.Messages.Predicates.MediaTypeHeaderContextPredicate&lt;TContext&gt;.
 */
export class MediaTypeHeaderContextPredicate<TContext> extends HeaderContextPredicate<TContext> {
  constructor(headerKey: string, mediaType: string) {
    super(headerKey, mediaType);
  }

  protected override isMatch(actualValue: string, expectedValue: string): boolean {
    return MediaType.matches(actualValue, expectedValue);
  }
}
