/** Port of Benzene.Schema.OpenApi.EventService.Event. */

/**
 * One `events[]` entry of the Contract Document (contract-document.md §3.1): a topic this service publishes
 * and defines, with its `message` payload schema (usually a `$ref`). `version` serializes only when
 * non-empty; `example` only when an author supplied one.
 */
export class Event {
  version = '';
  example?: unknown;

  constructor(
    readonly topic: string,
    readonly message: Record<string, unknown>,
  ) {}

  toJson(): Record<string, unknown> {
    const json: Record<string, unknown> = { topic: this.topic };
    if (this.version !== '') {
      json['version'] = this.version;
    }
    json['message'] = this.message;
    if (this.example !== undefined) {
      json['example'] = this.example;
    }
    return json;
  }
}
