/** Port of Benzene.MessagePack.Constants. */

/**
 * Shared constants for the MessagePack media format.
 * Port of Benzene.MessagePack.Constants (`const string` fields → module constants).
 */
export const Constants = {
  /** The request/response header carrying the media type. */
  contentTypeHeader: 'content-type',

  /** The content type this format reads and writes — the IANA-registered MessagePack MIME type. */
  messagePackContentType: 'application/msgpack',
} as const;
