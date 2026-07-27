/** Port of Benzene.Schema.OpenApi.EventService.RequestResponse. */
import { HttpMapping } from './HttpMapping';

/**
 * One consumed topic in the benzene spec document: its `request`/`response` payload schemas (usually a
 * `$ref` into `components.schemas`), plus version/reserved/httpMappings metadata. `version` and `reserved`
 * serialize only when meaningful (non-empty / true); `request`/`response` are always written. The generated
 * `example` field of the C# original is not ported (example generation is out of scope).
 */
export class RequestResponse {
  topic = '';
  version = '';
  reserved = false;
  httpMappings: HttpMapping[] = [];
  request: Record<string, unknown> = {};
  response: Record<string, unknown> = {};

  toJson(): Record<string, unknown> {
    const json: Record<string, unknown> = { topic: this.topic };
    if (this.version !== '') {
      json['version'] = this.version;
    }
    if (this.reserved) {
      json['reserved'] = true;
    }
    if (this.httpMappings.length > 0) {
      json['httpMappings'] = this.httpMappings.map((mapping) => mapping.toJson());
    }
    json['request'] = this.request;
    json['response'] = this.response;
    return json;
  }
}
