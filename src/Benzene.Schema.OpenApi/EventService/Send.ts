/** Port of Benzene.Schema.OpenApi.EventService.Send. */

/**
 * One `sends[]` entry of the Contract Document (contract-document.md §3.2): a message this service sends to
 * a topic another party defines. `request` is the schema of the message sent; `response`, the reply's —
 * **absent means one-way**, `{}` a reply of any shape. `version` serializes only when non-empty.
 */
export class Send {
  version = '';
  response?: Record<string, unknown>;

  constructor(
    readonly topic: string,
    readonly request: Record<string, unknown>,
  ) {}

  toJson(): Record<string, unknown> {
    const json: Record<string, unknown> = { topic: this.topic };
    if (this.version !== '') {
      json['version'] = this.version;
    }
    json['request'] = this.request;
    if (this.response !== undefined) {
      json['response'] = this.response;
    }
    return json;
  }
}
