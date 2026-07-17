/**
 * Compares media-type header values (e.g. a `content-type` or `accept` header) against a target
 * media type, tolerant of the parameters and casing real HTTP traffic carries — `"application/json;
 * charset=utf-8"` and `"Application/JSON"` both match `"application/json"`.
 * Port of Benzene.Core.Messages.Helper.MediaType.
 */
export const MediaType = {
  /**
   * Checks whether a media-type header value matches a target media type, ignoring any
   * `;`-delimited parameters and comparing case-insensitively. Port of C# `Matches`.
   */
  matches(headerValue: string | undefined, mediaType: string): boolean {
    if (headerValue === undefined || headerValue === '') {
      return false;
    }

    const semicolonIndex = headerValue.indexOf(';');
    const value = semicolonIndex >= 0 ? headerValue.slice(0, semicolonIndex) : headerValue;

    return value.trim().toLowerCase() === mediaType.trim().toLowerCase();
  },
} as const;
