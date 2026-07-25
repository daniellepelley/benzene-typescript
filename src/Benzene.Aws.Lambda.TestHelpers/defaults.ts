import { MessageSerializer } from '@benzene/testing';

/** The default body serializer for the transport builders (C#'s default `new JsonSerializer()`). */
export const jsonMessageSerializer: MessageSerializer = {
  serialize: (payload) => JSON.stringify(payload),
};
