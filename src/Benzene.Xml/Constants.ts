/** Port of Benzene.Xml.Constants. */

/**
 * Shared constants for the XML media format.
 * Port of Benzene.Xml.Constants (`const string` fields → module constants).
 */
export const Constants = {
  /** The request/response header carrying the media type. */
  contentTypeHeader: 'content-type',

  /** The content type this format reads and writes. */
  xmlContentType: 'application/xml',
} as const;
