/** Port of Benzene.Schema.OpenApi.SpecRequest. */

/**
 * The request payload of the `spec` topic: which document `type` (`benzene` (default), `openapi`, or
 * `asyncapi`) and `format`. Both optional; a bare invoke yields the default benzene document. Every format
 * is serialised as JSON, so `format` is currently informational (the C# `yaml` output is not ported).
 */
export class SpecRequest {
  type?: string;
  format?: string;

  constructor(type?: string, format?: string) {
    this.type = type;
    this.format = format;
  }
}
