/**
 * Port of Benzene.Clients.BenzeneMessageClientResponse.
 *
 * The response envelope returned by a Benzene service invoked through a message client. Deserializes
 * from the standard Benzene message envelope (`{ "statusCode": ..., "headers": { ... }, "body": "..." }`)
 * written by the serving side's `BenzeneMessageResponse`. `statusCode` carries a Benzene result status
 * (e.g. `"Ok"`, `"NotFound"`); numeric HTTP status codes from older or HTTP-shaped services are also
 * tolerated by the result-mapping helpers.
 *
 * C# `IDictionary<string, string>? headers = null` maps to an optional `Record<string, string>`
 * defaulting to `{}` (C# `null` -> `undefined`).
 */
export class BenzeneMessageClientResponse {
  readonly statusCode: string;
  readonly headers: Record<string, string>;
  readonly body: string;

  constructor(statusCode: string, body: string, headers?: Record<string, string>) {
    this.statusCode = statusCode;
    this.body = body;
    this.headers = headers ?? {};
  }
}
