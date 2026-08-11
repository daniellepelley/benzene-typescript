/** Port of Benzene.Schema.OpenApi.AsyncApi.AsyncApiSpecOptions. */

/** The default reply-channel suffix; kept in step with `AsyncApiDocumentBuilder.DefaultResponseTopicSuffix`. */
export const DEFAULT_RESPONSE_TOPIC_SUFFIX = 'response';

/**
 * App-wide options for the generated AsyncAPI document. Register one (see
 * `setAsyncApiResponseTopicSuffix`) to override the defaults; when none is registered,
 * `AsyncApiDocumentBuilder`'s defaults apply.
 */
export class AsyncApiSpecOptions {
  /**
   * The suffix appended to a handled topic to name its reply channel's address (`<topic>:<suffix>`).
   * Defaults to `response`, so a handler on `shipping:get-all` replies on `shipping:get-all:response`.
   */
  responseTopicSuffix: string = DEFAULT_RESPONSE_TOPIC_SUFFIX;
}
