import { MessageSerializer } from '@benzenejs/testing';

/** The default body serializer for the builder (C#'s default `new JsonSerializer()`). */
export const jsonMessageSerializer: MessageSerializer = {
  serialize: (payload) => JSON.stringify(payload),
};
