/** Port of Benzene.Aws.Lambda.EventBridge.EventBridgeMessageHeadersGetter. */
import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { EventBridgeContext } from './EventBridgeContext';

/**
 * Maps the event onto Benzene headers (C# plan decision E4): envelope metadata under `eventbridge-`-prefixed
 * keys, plus any Benzene wire headers (correlation, `traceparent`, ...) lifted verbatim from the reserved
 * `_benzeneHeaders` object inside `detail` — EventBridge has no native per-message attributes, so that's
 * where the outbound client embeds them. Embedded headers win over prefixed envelope keys on collision;
 * string values only.
 *
 * Field mapping: C# `Event.Id`/`Source`/`Account`/`Region`/`Time`/`DetailType` become `event.id`/`source`/
 * `account`/`region`/`time`/`event['detail-type']`. C# `Detail.TryGetProperty(...)` over a `JsonElement`
 * becomes a plain property read on the parsed `detail` object.
 */
export class EventBridgeMessageHeadersGetter implements IMessageHeadersGetter<EventBridgeContext> {
  /** The reserved key inside `detail` that carries embedded Benzene wire headers. */
  static readonly EmbeddedHeadersKey = '_benzeneHeaders';

  getHeaders(context: EventBridgeContext): Record<string, string> {
    const headers: Record<string, string> = {};
    const event = context.event;

    addIfPresent(headers, 'eventbridge-id', event.id);
    addIfPresent(headers, 'eventbridge-source', event.source);
    addIfPresent(headers, 'eventbridge-account', event.account);
    addIfPresent(headers, 'eventbridge-region', event.region);
    addIfPresent(headers, 'eventbridge-time', event.time);
    addIfPresent(headers, 'eventbridge-detail-type', event['detail-type']);

    const detail = event.detail;
    if (detail !== null && typeof detail === 'object') {
      const embedded = (detail as Record<string, unknown>)[
        EventBridgeMessageHeadersGetter.EmbeddedHeadersKey
      ];
      if (embedded !== null && typeof embedded === 'object') {
        for (const [name, value] of Object.entries(embedded as Record<string, unknown>)) {
          if (typeof value === 'string') {
            headers[name] = value;
          }
        }
      }
    }

    return headers;
  }
}

/** Port of C# `AddIfPresent` (C# `!string.IsNullOrEmpty`). */
function addIfPresent(headers: Record<string, string>, key: string, value: string | undefined): void {
  if (value !== undefined && value !== '') {
    headers[key] = value;
  }
}
