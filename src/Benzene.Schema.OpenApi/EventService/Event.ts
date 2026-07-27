/** Port of Benzene.Schema.OpenApi.EventService.Event. */

/**
 * One produced/sent topic in the benzene spec document (its `events` array): the topic and its `message`
 * payload schema (usually a `$ref`). `version` serializes only when non-empty. The C# `example` field is
 * not ported.
 */
export class Event {
  version = '';

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
    return json;
  }
}
