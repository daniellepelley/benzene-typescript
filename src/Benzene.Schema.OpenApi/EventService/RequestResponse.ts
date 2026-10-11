/** Port of Benzene.Schema.OpenApi.EventService.RequestResponse. */
import { HttpMapping } from './HttpMapping';

/**
 * One `requests[]` entry of the Contract Document (contract-document.md §2): a topic this service serves,
 * its `request` and optional `response` payload schemas (usually a `$ref` into `components.schemas`), its
 * version and its HTTP routes. `version` serializes only when non-empty; `httpMappings` only when there are
 * some; `response` only when the handler returns a payload — **absent means no payload**, `{}` a payload
 * of any shape; `example` only when an author supplied one (examples are never synthesized).
 */
export class RequestResponse {
  topic = '';
  version = '';
  httpMappings: HttpMapping[] = [];
  request: Record<string, unknown> = {};
  response?: Record<string, unknown>;
  example?: unknown;

  toJson(): Record<string, unknown> {
    const json: Record<string, unknown> = { topic: this.topic };
    if (this.version !== '') {
      json['version'] = this.version;
    }
    if (this.httpMappings.length > 0) {
      json['httpMappings'] = this.httpMappings.map((mapping) => mapping.toJson());
    }
    json['request'] = this.request;
    if (this.response !== undefined) {
      json['response'] = this.response;
    }
    if (this.example !== undefined) {
      json['example'] = this.example;
    }
    return json;
  }
}
