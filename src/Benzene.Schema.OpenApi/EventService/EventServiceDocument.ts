/** Port of Benzene.Schema.OpenApi.EventService.EventServiceDocument. */
import { Event } from './Event';
import { RequestResponse } from './RequestResponse';

/** The optional `info` block (from the app's `IApplicationInfo`). */
export interface EventServiceInfo {
  title?: string;
  description?: string;
  version?: string;
}

/**
 * The `benzene` spec document: `{ openapi, info?, transports?, requests[], events[], components.schemas }`.
 * This is exactly the shape the mesh aggregator's `parseTopics` reads (`requests[].request/response`,
 * `events[].message`, `components.schemas` for `$ref` resolution). `info`/`transports` serialize only when
 * present/non-empty; `requests`/`events`/`components` are always written. The C# `tags`/`messageEndpoint`
 * fields and the OpenAPI/AsyncAPI output formats are not ported.
 */
export class EventServiceDocument {
  info?: EventServiceInfo;
  transports: string[] = [];

  constructor(
    readonly requests: RequestResponse[],
    readonly events: Event[],
    readonly components: Record<string, Record<string, unknown>>,
  ) {}

  toJson(): Record<string, unknown> {
    const json: Record<string, unknown> = { openapi: '3.0.1' };
    if (this.info !== undefined) {
      json['info'] = this.info;
    }
    if (this.transports.length > 0) {
      json['transports'] = this.transports;
    }
    json['requests'] = this.requests.map((request) => request.toJson());
    json['events'] = this.events.map((event) => event.toJson());
    json['components'] = { schemas: this.components };
    return json;
  }
}
