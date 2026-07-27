/** Port of Benzene.Azure.Function.EventGrid.EventGridTriggerEvent. */

/**
 * The init shape for {@link EventGridTriggerEvent}. C# uses `{ get; init; }` object-initializer
 * properties; the idiomatic TypeScript equivalent is an optional-field init object passed to the
 * constructor. `data` is `unknown` because it carries an arbitrary parsed-JSON payload.
 */
export interface EventGridTriggerEventInit {
  id?: string;
  eventType?: string;
  subject?: string;
  source?: string;
  eventTime?: Date;
  dataVersion?: string;
  data?: unknown;
}

/**
 * Benzene's own model of an Event Grid delivery — dependency-free (a parsed-JSON value for the payload,
 * no `Azure.Messaging.EventGrid`), mirroring how the .NET package models it (and how
 * `@benzene/aws-lambda-kinesis`/`eventbridge` model their Lambda events). Covers both wire schemas
 * Event Grid can deliver: the Event Grid schema (`eventType`/`topic`) and CloudEvents 1.0
 * (`type`/`source`, detected by `specversion`) — see {@link parse}.
 *
 * PLATFORM MAPPING: C# `JsonElement?` (the BCL JSON payload) maps to `unknown` — the value produced by
 * `JSON.parse`. A property that is ABSENT stays `undefined` (C# `null` `JsonElement?`), which is what
 * `EventGridMessageBodyGetter` distinguishes to fall back to `{}`; a present JSON `null` parses to
 * `null`, kept distinct. `DateTimeOffset?` maps to `Date | undefined`.
 */
export class EventGridTriggerEvent {
  /** The event's unique id. */
  readonly id?: string;

  /**
   * The event type (Event Grid schema `eventType`, CloudEvents `type`) — e.g.
   * `Microsoft.Storage.BlobCreated` or your own custom type. This is also the topic the event routes by.
   */
  readonly eventType?: string;

  /** The publisher-defined subject path (both schemas' `subject`). */
  readonly subject?: string;

  /**
   * The full resource path of the event source (Event Grid schema `topic`, CloudEvents `source`). Named
   * to avoid colliding with Benzene's own routing notion of "topic", which is {@link eventType} here.
   */
  readonly source?: string;

  /** When the event was generated (Event Grid schema `eventTime`, CloudEvents `time`). */
  readonly eventTime?: Date;

  /** The schema version of the data object (Event Grid schema only). */
  readonly dataVersion?: string;

  /**
   * The event's payload, as a parsed-JSON value (both schemas' `data`). `undefined` when the event
   * carries no `data` property.
   */
  readonly data?: unknown;

  constructor(init: EventGridTriggerEventInit = {}) {
    this.id = init.id;
    this.eventType = init.eventType;
    this.subject = init.subject;
    this.source = init.source;
    this.eventTime = init.eventTime;
    this.dataVersion = init.dataVersion;
    this.data = init.data;
  }

  /**
   * Parses a raw delivery — the `[EventGridTrigger] string` binding — into an
   * `EventGridTriggerEvent`, handling both the Event Grid schema and CloudEvents 1.0 (detected by the
   * presence of `specversion`). Port of C# `EventGridTriggerEvent.Parse(string)`.
   *
   * @param json The event JSON as delivered to the trigger.
   * @returns The parsed event.
   */
  static parse(json: string): EventGridTriggerEvent {
    const root = JSON.parse(json) as Record<string, unknown>;
    const isCloudEvent = Object.prototype.hasOwnProperty.call(root, 'specversion');

    return new EventGridTriggerEvent({
      id: getString(root, 'id'),
      eventType: isCloudEvent ? getString(root, 'type') : getString(root, 'eventType'),
      subject: getString(root, 'subject'),
      source: isCloudEvent ? getString(root, 'source') : getString(root, 'topic'),
      eventTime: getTime(root, isCloudEvent ? 'time' : 'eventTime'),
      dataVersion: getString(root, 'dataVersion'),
      data: Object.prototype.hasOwnProperty.call(root, 'data') ? root['data'] : undefined,
    });
  }
}

function getString(root: Record<string, unknown>, name: string): string | undefined {
  const value = root[name];
  return typeof value === 'string' ? value : undefined;
}

function getTime(root: Record<string, unknown>, name: string): Date | undefined {
  const value = root[name];
  if (typeof value !== 'string') {
    return undefined;
  }
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? undefined : time;
}
