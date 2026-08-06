import { MessageSerializer } from '@benzene/testing';

/** The default body serializer for the Google Cloud Functions Pub/Sub builders (C#'s default `new JsonSerializer()`). */
export const jsonMessageSerializer: MessageSerializer = {
  serialize: (payload) => JSON.stringify(payload),
};
