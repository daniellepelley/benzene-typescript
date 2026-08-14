/** Port of Benzene.Azure.Function.EventHub.TestHelpers.MessageBuilderExtensions. */
import type { ReceivedEventData } from '@azure/event-hubs';
import { IMessageBuilder } from '@benzenejs/abstractions';
import { asBenzeneMessage, MessageSerializer } from '@benzenejs/testing';
import { jsonMessageSerializer } from './defaults';

export interface AsEventHubBenzeneMessageOptions {
  serializer?: MessageSerializer;
}

/**
 * Builds a `ReceivedEventData` whose body is a serialized BenzeneMessage envelope (`{ topic, headers,
 * body }`) - Event Hub has no per-message topic property, so routing rides in the envelope and the inner
 * `useBenzeneMessage` pipeline routes on its topic. Port of `AsEventHubBenzeneMessage`.
 */
export function asEventHubBenzeneMessage<T>(
  source: IMessageBuilder<T>,
  options: AsEventHubBenzeneMessageOptions = {},
): ReceivedEventData {
  const { serializer = jsonMessageSerializer } = options;

  return {
    body: JSON.stringify(asBenzeneMessage(source, serializer)),
  } as unknown as ReceivedEventData;
}
