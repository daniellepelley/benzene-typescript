/** Port of Benzene.Avro.Constants. */

/**
 * Shared constants for the Avro media format.
 * Port of Benzene.Avro.Constants (`const string` fields → module constants).
 */
export const Constants = {
  /** The request/response header carrying the media type. */
  contentTypeHeader: 'content-type',

  /**
   * The content type this format reads and writes. `application/avro` is the conventional
   * media type for a bare Avro binary payload (no container/schema envelope).
   */
  avroContentType: 'application/avro',
} as const;
