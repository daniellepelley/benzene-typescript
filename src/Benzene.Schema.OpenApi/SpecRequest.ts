/** Port of Benzene.Schema.OpenApi.SpecRequest. */

/**
 * The request payload of the `benzene:spec` topic (contract-document.md §7): which document `type`
 * (`benzene` (default), or this port's extensions `openapi` and `asyncapi`) and `format` (`json`, the only one
 * served). Both optional: an absent body, `null` or `{}` is the Contract Document as JSON; anything else
 * unsupported is answered `not-implemented`. Over HTTP, `GET /benzene/spec` copies its `type`/`format`
 * query parameters onto it.
 */
export class SpecRequest {
  type?: string;
  format?: string;

  constructor(type?: string, format?: string) {
    this.type = type;
    this.format = format;
  }
}
