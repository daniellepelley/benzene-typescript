/**
 * A simplified, transport-agnostic HTTP request used for routing and processing.
 * Port of Benzene.Http.HttpRequest (C# `IDictionary<string, string>` maps to `Record<string, string>`).
 */
export class HttpRequest {
  /** The HTTP method (GET, POST, PUT, DELETE, PATCH, ...). */
  method!: string;

  /** The URL path of the request, excluding query string parameters. */
  path!: string;

  /** The HTTP headers included in the request. */
  headers!: Record<string, string>;
}
