import { ITopic } from '@benzene/abstractions-messages';
import { Topic } from '@benzene/core-messages';

/**
 * Well-known constants shared across the message handler pipeline (routing, headers,
 * content types).
 * Port of Benzene.Core.MessageHandlers.Constants.
 */
export const Constants = {
  /**
   * A sentinel ITopic (id `"<missing>"`) used wherever a message's topic could not be
   * determined, e.g. when no handler could be resolved for an inbound message.
   */
  get missing(): ITopic {
    return new Topic('<missing>');
  },

  /** The lower-case header name used for the content-type of a message body ("content-type"). */
  contentTypeHeader: 'content-type',

  /** The MIME type value ("application/json") used when a response body is JSON-encoded. */
  jsonContentType: 'application/json',
} as const;
