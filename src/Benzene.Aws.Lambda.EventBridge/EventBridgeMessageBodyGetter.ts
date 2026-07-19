/** Port of Benzene.Aws.Lambda.EventBridge.EventBridgeMessageBodyGetter. */
import { IMessageBodyGetter } from '@benzene/abstractions-messages';
import { EventBridgeContext } from './EventBridgeContext';

/**
 * The message body is the JSON text of the event's `detail` — the domain payload (C# plan decision E3).
 *
 * TYPE-MODEL adaptation: C# reads a raw `JsonElement` and returns `detail.GetRawText()` (or `null` when the
 * detail is `Undefined`). In Node the event is already parsed, so `detail` is a value; `JSON.stringify`
 * reproduces the raw JSON text, and an absent detail maps to `undefined` (C# `null`). The reserved
 * `_benzeneHeaders` key, when present inside `detail`, is an extra field the request mapper's
 * deserialization simply ignores.
 */
export class EventBridgeMessageBodyGetter implements IMessageBodyGetter<EventBridgeContext> {
  getBody(context: EventBridgeContext): string | undefined {
    const detail = context.event.detail;
    return detail === undefined ? undefined : JSON.stringify(detail);
  }
}
