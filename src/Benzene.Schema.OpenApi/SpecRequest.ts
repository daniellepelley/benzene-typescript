/** Port of Benzene.Schema.OpenApi.SpecRequest. */

/**
 * The request payload of the `spec` topic: which document `type` (only `benzene` is produced by this port —
 * the `openapi`/`asyncapi` output formats are not ported yet) and `format`. Both optional; a bare invoke
 * yields the default benzene JSON document.
 */
export class SpecRequest {
  type?: string;
  format?: string;

  constructor(type?: string, format?: string) {
    this.type = type;
    this.format = format;
  }
}
